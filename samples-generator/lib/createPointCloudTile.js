'use strict';
var Cesium = require('cesium');
var draco3d = require('draco3d');
var SimplexNoise = require('simplex-noise');
var createPnts = require('./createPnts');

var AttributeCompression = Cesium.AttributeCompression;
var Cartesian2 = Cesium.Cartesian2;
var Cartesian3 = Cesium.Cartesian3;
var CesiumMath = Cesium.Math;
var Color = Cesium.Color;
var ComponentDatatype = Cesium.ComponentDatatype;
var defaultValue = Cesium.defaultValue;
var defined = Cesium.defined;
var Matrix4 = Cesium.Matrix4;
var WebGLConstants = Cesium.WebGLConstants;

module.exports = createPointCloudTile;

var sizeOfUint8 = 1;
var sizeOfUint16 = 2;
var sizeOfUint32 = 4;
var sizeOfFloat32 = 4;

CesiumMath.setRandomNumberSeed(0);
var simplex = new SimplexNoise(CesiumMath.nextRandomNumber);

var encoderModule = draco3d.createEncoderModule({});

/**
 * Creates a pnts tile that represents a point cloud.
 *
 * @param {Object} [options] Object with the following properties:
 * @param {Number} [options.tileWidth=10.0] The width of the tile in meters.
 * @param {Matrix4} [options.transform=Matrix4.IDENTITY] A transform to bake into the tile, for example a transform into WGS84.
 * @param {Number} [options.pointsLength=1000] The number of points in the point cloud.
 * @param {String} [options.colorMode='rgb'] The mode in which colors are saved. Possible values are 'rgb', 'rgba', 'rgb565', 'constant', 'none'.
 * @param {String} [options.color='random'] Determines the method for generating point colors. Possible values are 'random', 'gradient', 'noise'.
 * @param {String} [options.shape='box'] The shape of the point cloud. Possible values are 'sphere', 'box'.
 * @param {Boolean} [options.generateNormals=false] Generate per-point normals.
 * @param {Boolean} [options.draco=false] Use draco encoding.
 * @param [String[]] [options.dracoSemantics] An array of semantics to draco encode. If undefined, all semantics are encoded.
 * @param {Boolean} [options.octEncodeNormals=false] Apply oct16p encoding on the point normals.
 * @param {Boolean} [options.quantizePositions=false] Quantize point positions so each x, y, z takes up 16 bits rather than 32 bits.
 * @param {Boolean} [options.batched=false] Group points together with batch ids and generate per-batch metadata. Good for differentiating different sections of a point cloud. Not compatible with perPointProperties.
 * @param {Boolean} [options.perPointProperties=false] Generate per-point metadata.
 * @param {Boolean} [options.relativeToCenter=true] Define point positions relative-to-center.
 * @param {Boolean} [options.time=0.0] Time value when generating 4D simplex noise.
 *
 * @returns {Object} An object containing the pnts buffer and batch table JSON.
 */
function createPointCloudTile(options) {
    // Set the random number seed before creating each point cloud so that the generated points are the same between runs
    CesiumMath.setRandomNumberSeed(0);

    options = defaultValue(options, defaultValue.EMPTY_OBJECT);
    var tileWidth = defaultValue(options.tileWidth, 10.0);
    var transform = defaultValue(options.transform, Matrix4.IDENTITY);
    var pointsLength = defaultValue(options.pointsLength, 1000);
    var colorMode = defaultValue(options.colorMode, 'rgb');
    var color = defaultValue(options.color, 'random');
    var shape = defaultValue(options.shape, 'box');
    var generateNormals = defaultValue(options.generateNormals, false);
    var draco = defaultValue(options.draco, false);
    var dracoSemantics = options.dracoSemantics;
    var octEncodeNormals = defaultValue(options.octEncodeNormals, false) && !draco;
    var quantizePositions = defaultValue(options.quantizePositions, false) && !draco;
    var batched = defaultValue(options.batched, false);
    var perPointProperties = defaultValue(options.perPointProperties, false);
    var relativeToCenter = defaultValue(options.relativeToCenter, true);
    var time = defaultValue(options.time, 0.0);

    if (colorMode === 'rgb565' && draco) {
        colorMode = 'rgb';
    }

    var radius = tileWidth / 2.0;
    var center = Matrix4.getTranslation(transform, new Cartesian3());

    var shapeFunction;
    if (shape === 'sphere') {
        shapeFunction = sphereFunction;
    } else if (shape === 'box') {
        shapeFunction = boxFunction;
    }

    var colorFunction;
    if (color === 'random') {
        colorFunction = randomFunction;
    } else if (color === 'gradient') {
        colorFunction = gradientFunction;
    } else if (color === 'noise') {
        colorFunction = getNoiseFunction(time);
    }

    var colorModeFunction;
    var constantColor;
    if (colorMode === 'rgb') {
        colorModeFunction = getColorsRGB;
    } else if (colorMode === 'rgba') {
        colorModeFunction = getColorsRGBA;
    } else if (colorMode === 'rgb565') {
        colorModeFunction = getColorsRGB565;
    } else if (colorMode === 'constant') {
        constantColor = [255, 255, 0, 51];
    }

    var points = getPoints(pointsLength, radius, colorModeFunction, colorFunction, shapeFunction, quantizePositions, octEncodeNormals, relativeToCenter, transform, time);
    var positions = points.positions;
    var normals = points.normals;
    var batchIds = points.batchIds;
    var colors = points.colors;
    var noiseValues = points.noiseValues;

    var featureTableProperties = [positions];
    if (defined(colors)) {
        featureTableProperties.push(colors);
    }
    if (generateNormals) {
        featureTableProperties.push(normals);
    }
    if (batched) {
        featureTableProperties.push(batchIds);
    }

    var batchTableProperties = [];
    if (perPointProperties) {
        batchTableProperties = getPerPointBatchTableProperties(pointsLength, noiseValues);
    }

    var featureTableJson = {};
    var featureTableBinary = Buffer.alloc(0);

    var batchTableJson = {};
    var batchTableBinary = Buffer.alloc(0);

    var extensionsUsed;

    var dracoBuffer;
    var dracoFeatureTableJson;
    var dracoBatchTableJson;

    if (draco) {
        var dracoResults = dracoEncode(pointsLength, dracoSemantics, featureTableProperties, batchTableProperties);
        dracoBuffer = dracoResults.buffer;
        dracoFeatureTableJson = dracoResults.dracoFeatureTableJson;
        dracoBatchTableJson = dracoResults.dracoBatchTableJson;
        featureTableBinary = Buffer.concat([featureTableBinary, dracoBuffer]);
        if (defined(dracoFeatureTableJson)) {
            featureTableJson.extensions = {
                '3DTILES_draco_point_compression' : dracoFeatureTableJson
            };
        }
        if (defined(dracoBatchTableJson)) {
            batchTableJson.extensions = {
                '3DTILES_draco_point_compression' : dracoBatchTableJson
            };
        }
        extensionsUsed = ['3DTILES_draco_point_compression'];
    }

    var i;
    var property;
    var name;
    var componentType;
    var byteOffset;
    var byteAlignment;
    var padding;

    for (i = 0; i < featureTableProperties.length; ++i) {
        property = featureTableProperties[i];
        name = property.propertyName;
        componentType = property.componentType;
        byteOffset = 0;
        if (!(defined(dracoFeatureTableJson) && defined(dracoFeatureTableJson.properties[name]))) {
            byteAlignment = ComponentDatatype.getSizeInBytes(ComponentDatatype[componentType]);
            byteOffset = Math.ceil(featureTableBinary.length / byteAlignment) * byteAlignment; // Round up to the required alignment
            padding = Buffer.alloc(byteOffset - featureTableBinary.length);
            featureTableBinary = Buffer.concat([featureTableBinary, padding, property.buffer]);
        }
        featureTableJson[name] = {
            byteOffset : byteOffset,
            componentType : name === 'BATCH_ID' ? componentType : undefined
        };
    }

    for (i = 0; i < batchTableProperties.length; ++i) {
        property = batchTableProperties[i];
        name = property.propertyName;
        componentType = property.componentType;
        byteOffset = 0;
        if (!(defined(dracoBatchTableJson) && defined(dracoBatchTableJson.properties[name]))) {
            byteAlignment = ComponentDatatype.getSizeInBytes(ComponentDatatype[componentType]);
            byteOffset = Math.ceil(batchTableBinary.length / byteAlignment) * byteAlignment; // Round up to the required alignment
            padding = Buffer.alloc(byteOffset - batchTableBinary.length);
            batchTableBinary = Buffer.concat([batchTableBinary, padding, property.buffer]);
        }
        batchTableJson[name] = {
            byteOffset : byteOffset,
            componentType : componentType,
            type : property.type
        };
    }

    featureTableJson.POINTS_LENGTH = pointsLength;

    if (defined(constantColor)) {
        featureTableJson.CONSTANT_RGBA = constantColor;
    }

    if (quantizePositions) {
        // Quantized offset is the lower left, unlike RTC_CENTER which is the center
        featureTableJson.QUANTIZED_VOLUME_SCALE = [tileWidth, tileWidth, tileWidth];
        featureTableJson.QUANTIZED_VOLUME_OFFSET = [center.x - radius, center.y - radius, center.z - radius];
    } else if (relativeToCenter){
        featureTableJson.RTC_CENTER = [center.x, center.y, center.z];
    }

    if (batched) {
        var batchTable = getBatchTableForBatchedPoints(batchIds.batchLength);
        batchTableJson = batchTable.json;
        batchTableBinary = batchTable.binary;
        featureTableJson.BATCH_LENGTH = batchIds.batchLength;
    }

    var pnts = createPnts({
        featureTableJson : featureTableJson,
        featureTableBinary : featureTableBinary,
        batchTableJson : batchTableJson,
        batchTableBinary : batchTableBinary
    });

    return {
        pnts : pnts,
        batchTableJson : batchTableJson,
        extensionsUsed : extensionsUsed
    };
}

function getAddAttributeFunctionName(componentDatatype) {
    switch (componentDatatype) {
        case WebGLConstants.UNSIGNED_BYTE:
            return 'AddUInt8Attribute';
        case WebGLConstants.BYTE:
            return 'AddInt8Attribute';
        case WebGLConstants.UNSIGNED_SHORT:
            return 'AddUInt16Attribute';
        case WebGLConstants.SHORT:
            return 'AddInt16Attribute';
        case WebGLConstants.UNSIGNED_INT:
            return 'AddUInt32Attribute';
        case WebGLConstants.INT:
            return 'AddInt32Attribute';
        case WebGLConstants.FLOAT:
            return 'AddFloatAttribute';
    }
}

function numberOfComponentsForType(type) {
    switch (type) {
        case 'SCALAR':
            return 1;
        case 'VEC2':
            return 2;
        case 'VEC3':
            return 3;
        case 'VEC4':
            return 4;
    }
}

function getDracoType(name) {
    switch (name) {
        case 'POSITION':
            return encoderModule.POSITION;
        case 'NORMAL':
            return encoderModule.NORMAL;
        case 'RGB':
        case 'RGBA':
            return encoderModule.COLOR;
        default:
            return encoderModule.GENERIC;
    }
}

function dracoEncodeProperties(pointsLength, properties, preserveOrder) {
    var i;
    var encoder = new encoderModule.Encoder();
    var pointCloudBuilder = new encoderModule.PointCloudBuilder();
    var pointCloud = new encoderModule.PointCloud();

    var attributeIds = {};

    var length = properties.length;
    for (i = 0; i < length; ++i) {
        var property = properties[i];
        var componentDatatype = ComponentDatatype[property.componentType];
        var typedArray = ComponentDatatype.createArrayBufferView(componentDatatype, property.buffer.buffer);
        var numberOfComponents = numberOfComponentsForType(property.type);
        var addAttributeFunctionName = getAddAttributeFunctionName(componentDatatype);
        var name = property.propertyName;
        var dracoType = getDracoType(name);
        attributeIds[name] = pointCloudBuilder[addAttributeFunctionName](pointCloud, dracoType, pointsLength, numberOfComponents, typedArray);
    }

    var dracoCompressionSpeed = 7;
    var dracoPositionBits = 14;
    var dracoNormalBits = 8;
    var dracoColorBits = 8;
    var dracoGenericBits =  12;

    encoder.SetSpeedOptions(dracoCompressionSpeed);
    encoder.SetAttributeQuantization(encoderModule.POSITION, dracoPositionBits);
    encoder.SetAttributeQuantization(encoderModule.NORMAL, dracoNormalBits);
    encoder.SetAttributeQuantization(encoderModule.COLOR, dracoColorBits);
    encoder.SetAttributeQuantization(encoderModule.GENERIC, dracoGenericBits);

    if (preserveOrder) {
        encoder.SetEncodingMethod(encoderModule.POINT_CLOUD_SEQUENTIAL_ENCODING);
    }

    var encodedDracoDataArray = new encoderModule.DracoInt8Array();

    var encodedLength = encoder.EncodePointCloudToDracoBuffer(pointCloud, false, encodedDracoDataArray);
    if (encodedLength <= 0) {
        throw 'Error: Encoding Failed.';
    }

    var encodedData = Buffer.alloc(encodedLength);
    for (i = 0; i < encodedLength; i++) {
        encodedData[i] = encodedDracoDataArray.GetValue(i);
    }

    return {
        buffer : encodedData,
        attributeIds : attributeIds
    };
}

function getPropertyByName(properties, name) {
    return properties.find(function(element) {
        return element.propertyName === name;
    });
}

function dracoEncode(pointsLength, dracoSemantics, featureTableProperties, batchTableProperties) {
    var dracoProperties = [];
    if (!defined(dracoSemantics)) {
        dracoProperties = dracoProperties.concat(featureTableProperties);
    } else {
        for (var i = 0; i < dracoSemantics.length; ++i) {
            dracoProperties.push(getPropertyByName(featureTableProperties, dracoSemantics[i]));
        }
    }
    dracoProperties = dracoProperties.concat(batchTableProperties);

    // Check if normals are being encoded.
    // Currently the octahedron transform for normals only works if preserveOrder is true.
    // See https://github.com/google/draco/issues/383
    var encodeNormals = defined(getPropertyByName(dracoProperties, 'NORMAL'));
    var hasUncompressedAttributes =  dracoProperties.length < (featureTableProperties.length + batchTableProperties.length);
    var preserveOrder = encodeNormals || hasUncompressedAttributes;

    var dracoResults = dracoEncodeProperties(pointsLength, dracoProperties, preserveOrder);
    var dracoBuffer = dracoResults.buffer;
    var dracoAttributeIds = dracoResults.attributeIds;

    var dracoFeatureTableJson = {
        properties : {},
        byteOffset : 0,
        byteLength : dracoBuffer.length
    };
    var dracoBatchTableJson = {
        properties : {}
    };

    for (var name in dracoAttributeIds) {
        if (dracoAttributeIds.hasOwnProperty(name)) {
            if (defined(getPropertyByName(featureTableProperties, name))) {
                dracoFeatureTableJson.properties[name] = dracoAttributeIds[name];
            }
            if (defined(getPropertyByName(batchTableProperties, name))) {
                dracoBatchTableJson.properties[name] = dracoAttributeIds[name];
            }
        }
    }

    if (Object.keys(dracoFeatureTableJson).length === 0) {
        dracoFeatureTableJson = undefined;
    }
    if (Object.keys(dracoBatchTableJson).length === 0) {
        dracoBatchTableJson = undefined;
    }

    return {
        buffer : dracoBuffer,
        dracoFeatureTableJson : dracoFeatureTableJson,
        dracoBatchTableJson : dracoBatchTableJson
    };
}

// Return a position in the range of (-0.5, -0.5, -0.5) to (0.5, 0.5, 0.5) based on the index
function getPosition(i, pointsLength) {
    var width = Math.round(Math.pow(pointsLength, 1/3));
    var z = Math.floor(i / (width * width));
    var y = Math.floor((i - z * width * width) / width);
    var x = i - width * (y + width * z);

    x = x / (width - 1) - 0.5;
    y = y / (width - 1) - 0.5;
    z = z / (width - 1) - 0.5;

    return new Cartesian3(x, y, z);
}

function boxFunction(i, pointsLength, radius) {
    var position = getPosition(i, pointsLength);
    Cartesian3.multiplyByScalar(position, radius, position);
    return position;
}

function sphereFunction(i, pointsLength, radius) { //eslint-disable-line no-unused-vars
    var theta = CesiumMath.nextRandomNumber() * 2 * Math.PI;
    var phi = CesiumMath.nextRandomNumber() * Math.PI - Math.PI/2.0;
    var x = radius * Math.cos(theta) * Math.cos(phi);
    var y = radius * Math.sin(phi);
    var z = radius * Math.sin(theta) * Math.cos(phi);
    return new Cartesian3(x, y, z);
}

function randomFunction(position) { //eslint-disable-line no-unused-vars
    return Color.fromRandom();
}

function gradientFunction(position) {
    var r = position.x + 0.5;
    var g = position.y + 0.5;
    var b = position.z + 0.5;
    return new Color(r, g, b, 1.0);
}

function getNoise(position, time) {
    time = defaultValue(time, 0.0);
    return Math.abs(simplex.noise4D(position.x, position.y, position.z, time));
}

function getNoiseFunction(time) {
    return function(position) {
        var noise = getNoise(position, time);
        return new Color(noise, noise, noise, noise);
    };
}

function getBatchId(position) {
    // Set to batchId to 0-7 depending on which octant the position is in
    var x = (position.x > 0) ? 0 : 1;
    var y = (position.y > 0) ? 0 : 1;
    var z = (position.z > 0) ? 0 : 1;

    return (x << 2) | (y << 1) | z;
}

var scratchMatrix = new Matrix4();
var scratchCenter = new Cartesian3();

function getPoints(pointsLength, radius, colorModeFunction, colorFunction, shapeFunction, quantizePositions, octEncodeNormals, relativeToCenter, transform, time) {
    var inverseTranspose = scratchMatrix;
    Matrix4.transpose(transform, inverseTranspose);
    Matrix4.inverse(inverseTranspose, inverseTranspose);
    var center = Matrix4.getTranslation(transform, scratchCenter);

    var positions = new Array(pointsLength);
    var normals = new Array(pointsLength);
    var batchIds = new Array(pointsLength);
    var colors = new Array(pointsLength);
    var noiseValues = new Array(pointsLength);

    for (var i = 0; i < pointsLength; ++i) {
        var unitPosition = getPosition(i, pointsLength);
        var position = shapeFunction(i, pointsLength, radius);
        var normal;
        if (Cartesian3.equals(position, Cartesian3.ZERO)) {
            normal = new Cartesian3(1.0, 0.0, 0.0);
        } else {
            normal = Cartesian3.normalize(position, new Cartesian3());
        }
        var batchId = getBatchId(position);
        var color = colorFunction(unitPosition);
        var noise = getNoise(unitPosition, time);

        Matrix4.multiplyByPoint(transform, position, position);
        Matrix4.multiplyByPointAsVector(inverseTranspose, normal, normal);
        Cartesian3.normalize(normal, normal);

        if (relativeToCenter || quantizePositions) {
            Cartesian3.subtract(position, center, position);
        }

        positions[i] = position;
        normals[i] = normal;
        batchIds[i] = batchId;
        colors[i] = color;
        noiseValues[i] = noise;
    }

    var positionAttribute = quantizePositions ? getPositionsQuantized(positions, radius) : getPositions(positions);
    var normalAttribute = octEncodeNormals ? getNormalsOctEncoded(normals) : getNormals(normals);
    var batchIdAttribute = getBatchIds(batchIds);
    var colorAttribute = defined(colorModeFunction) ? colorModeFunction(colors) : undefined;

    return {
        positions : positionAttribute,
        normals : normalAttribute,
        batchIds : batchIdAttribute,
        colors : colorAttribute,
        noiseValues : noiseValues // Not an attribute - just send this back for generating metadata
    };
}

function getPositions(positions) {
    var pointsLength = positions.length;
    var buffer = Buffer.alloc(pointsLength * 3 * sizeOfFloat32);
    for (var i = 0; i < pointsLength; ++i) {
        var position = positions[i];
        buffer.writeFloatLE(position.x, (i * 3) * sizeOfFloat32);
        buffer.writeFloatLE(position.y, (i * 3 + 1) * sizeOfFloat32);
        buffer.writeFloatLE(position.z, (i * 3 + 2) * sizeOfFloat32);
    }
    return {
        buffer : buffer,
        propertyName : 'POSITION',
        componentType : 'FLOAT',
        type : 'VEC3'
    };
}

function getPositionsQuantized(positions, radius) {
    var min = -radius;
    var max = radius;
    var range = Math.pow(2, 16) - 1;
    var scale = max - min;
    var pointsLength = positions.length;
    var buffer = Buffer.alloc(pointsLength * 3 * sizeOfUint16);
    for (var i = 0; i < pointsLength; ++i) {
        var position = positions[i];
        var x = (position.x - min) * range / scale;
        var y = (position.y - min) * range / scale;
        var z = (position.z - min) * range / scale;
        buffer.writeUInt16LE(x, (i * 3) * sizeOfUint16);
        buffer.writeUInt16LE(y, (i * 3 + 1) * sizeOfUint16);
        buffer.writeUInt16LE(z, (i * 3 + 2) * sizeOfUint16);
    }
    return {
        buffer : buffer,
        propertyName : 'POSITION_QUANTIZED',
        componentType : 'UNSIGNED_SHORT',
        type : 'VEC3'
    };
}

function getNormals(normals) {
    var pointsLength = normals.length;
    var buffer = Buffer.alloc(pointsLength * 3 * sizeOfFloat32);
    for (var i = 0; i < pointsLength; ++i) {
        var normal = normals[i];
        buffer.writeFloatLE(normal.x, (i * 3) * sizeOfFloat32);
        buffer.writeFloatLE(normal.y, (i * 3 + 1) * sizeOfFloat32);
        buffer.writeFloatLE(normal.z, (i * 3 + 2) * sizeOfFloat32);
    }
    return {
        buffer : buffer,
        propertyName : 'NORMAL',
        componentType : 'FLOAT',
        type : 'VEC3'
    };
}

var scratchEncoded = new Cartesian2();

function getNormalsOctEncoded(normals) {
    var pointsLength = normals.length;
    var buffer = Buffer.alloc(pointsLength * 2 * sizeOfUint8);
    for (var i = 0; i < pointsLength; ++i) {
        var encodedNormal = AttributeCompression.octEncode(normals[i], scratchEncoded);
        buffer.writeUInt8(encodedNormal.x, i * 2);
        buffer.writeUInt8(encodedNormal.y, i * 2 + 1);
    }
    return {
        buffer : buffer,
        propertyName : 'NORMAL_OCT16P',
        componentType : 'UNSIGNED_BYTE',
        type : 'VEC2'
    };
}

function getBatchIds(batchIds) {
    // Find the batch length which determines whether the BATCH_ID buffer is byte, short, or int.
    var i;
    var pointsLength = batchIds.length;
    var batchLength = 0;
    for (i = 0; i < pointsLength; ++i) {
        batchLength = Math.max(batchIds[i] + 1, batchLength);
    }

    var buffer;
    var componentType;
    if (batchLength <= 256) {
        buffer = Buffer.alloc(pointsLength * sizeOfUint8);
        for (i = 0; i < pointsLength; ++i) {
            buffer.writeUInt8(batchIds[i], i * sizeOfUint8);
        }
        componentType = 'UNSIGNED_BYTE';
    } else if (batchLength <= 65536) {
        buffer = Buffer.alloc(pointsLength * sizeOfUint16);
        for (i = 0; i < pointsLength; ++i) {
            buffer.writeUInt16LE(batchIds[i], i * sizeOfUint16);
        }
        componentType = 'UNSIGNED_SHORT';
    } else {
        buffer = Buffer.alloc(pointsLength * sizeOfUint32);
        for (i = 0; i < pointsLength; ++i) {
            buffer.writeUInt32LE(batchIds[i], i * sizeOfUint32);
        }
        componentType = 'UNSIGNED_INT';
    }

    return {
        buffer : buffer,
        propertyName : 'BATCH_ID',
        componentType : componentType,
        type : 'SCALAR',
        batchLength : batchLength
    };
}

function getColorsRGB(colors) {
    var colorsLength = colors.length;
    var buffer = Buffer.alloc(colorsLength * 3);
    for (var i = 0; i < colorsLength; ++i) {
        var color = colors[i];
        var r = Math.floor(color.red * 255);
        var g = Math.floor(color.green * 255);
        var b = Math.floor(color.blue * 255);
        buffer.writeUInt8(r, i * 3);
        buffer.writeUInt8(g, i * 3 + 1);
        buffer.writeUInt8(b, i * 3 + 2);
    }
    return {
        buffer : buffer,
        propertyName : 'RGB',
        componentType : 'UNSIGNED_BYTE',
        type : 'VEC3'
    };
}

function getColorsRGBA(colors) {
    var colorsLength = colors.length;
    var buffer = Buffer.alloc(colorsLength * 4);
    for (var i = 0; i < colorsLength; ++i) {
        var color = colors[i];
        var r = Math.floor(color.red * 255);
        var g = Math.floor(color.green * 255);
        var b = Math.floor(color.blue * 255);
        var a = Math.floor(color.alpha * 128); // Make all alphas < 0.5 just so it's obvious
        buffer.writeUInt8(r, i * 4);
        buffer.writeUInt8(g, i * 4 + 1);
        buffer.writeUInt8(b, i * 4 + 2);
        buffer.writeUInt8(a, i * 4 + 3);
    }
    return {
        buffer : buffer,
        propertyName : 'RGBA',
        componentType : 'UNSIGNED_BYTE',
        type : 'VEC4'
    };
}

function getColorsRGB565(colors) {
    var colorsLength = colors.length;
    var buffer = Buffer.alloc(colorsLength * sizeOfUint16);
    for (var i = 0; i < colorsLength; ++i) {
        var color = colors[i];
        var r = Math.floor(color.red * 31); // 5 bits
        var g = Math.floor(color.green * 63); // 6 bits
        var b = Math.floor(color.blue * 31); // 5 bits
        var packedColor = (r << 11) + (g << 5) + b;
        buffer.writeUInt16LE(packedColor, i * sizeOfUint16);
    }
    return {
        buffer : buffer,
        propertyName : 'RGB565',
        componentType : 'UNSIGNED_SHORT',
        type : 'SCALAR'
    };
}

function getBatchTableForBatchedPoints(batchLength) {
    // Create some sample per-batch properties. Each batch will have a name, dimension, and id.
    var names = new Array(batchLength); // JSON array
    var dimensionsBuffer = Buffer.alloc(batchLength * 3 * sizeOfFloat32); // Binary
    var idBuffer = Buffer.alloc(batchLength * sizeOfUint32); // Binary

    var batchTableJson = {
        name : names,
        dimensions : {
            byteOffset : 0,
            componentType : 'FLOAT',
            type : 'VEC3'
        },
        id : {
            byteOffset : dimensionsBuffer.length,
            componentType : 'UNSIGNED_INT',
            type : 'SCALAR'
        }
    };

    for (var i = 0; i < batchLength; ++i) {
        names[i] = 'section' + i;
        dimensionsBuffer.writeFloatLE(CesiumMath.nextRandomNumber(), (i * 3) * sizeOfFloat32);
        dimensionsBuffer.writeFloatLE(CesiumMath.nextRandomNumber(), (i * 3 + 1) * sizeOfFloat32);
        dimensionsBuffer.writeFloatLE(CesiumMath.nextRandomNumber(), (i * 3 + 2) * sizeOfFloat32);
        idBuffer.writeUInt32LE(i, i * sizeOfUint32);
    }

    // No need for padding with these sample properties
    var batchTableBinary = Buffer.concat([dimensionsBuffer, idBuffer]);

    return {
        json : batchTableJson,
        binary : batchTableBinary
    };
}

function getPerPointBatchTableProperties(pointsLength, noiseValues) {
    // Create some sample per-point properties. Each point will have a temperature, secondary color, and id.
    var temperaturesBuffer = Buffer.alloc(pointsLength * sizeOfFloat32);
    var secondaryColorBuffer = Buffer.alloc(pointsLength * 3 * sizeOfFloat32);
    var idBuffer = Buffer.alloc(pointsLength * sizeOfUint16);

    for (var i = 0; i < pointsLength; ++i) {
        var temperature = noiseValues[i];
        var secondaryColor = [CesiumMath.nextRandomNumber(), 0.0, 0.0];
        temperaturesBuffer.writeFloatLE(temperature, i * sizeOfFloat32);
        secondaryColorBuffer.writeFloatLE(secondaryColor[0], (i * 3) * sizeOfFloat32);
        secondaryColorBuffer.writeFloatLE(secondaryColor[1], (i * 3 + 1) * sizeOfFloat32);
        secondaryColorBuffer.writeFloatLE(secondaryColor[2], (i * 3 + 2) * sizeOfFloat32);
        idBuffer.writeUInt16LE(i, i * sizeOfUint16);
    }

    return [
        {
            buffer : temperaturesBuffer,
            propertyName : 'temperature',
            componentType : 'FLOAT',
            type: 'SCALAR'
        },
        {
            buffer : secondaryColorBuffer,
            propertyName : 'secondaryColor',
            componentType : 'FLOAT',
            type : 'VEC3'
        },
        {
            buffer : idBuffer,
            propertyName : 'id',
            componentType : 'UNSIGNED_SHORT',
            type : 'SCALAR'
        }
    ];
}
