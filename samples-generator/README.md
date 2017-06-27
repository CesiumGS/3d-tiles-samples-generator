# 3D Tiles Samples Generator

The tilesets generated here are included in [3d-tiles-samples](https://github.com/AnalyticalGraphicsInc/3d-tiles-samples) and [Cesium](https://github.com/AnalyticalGraphicsInc/cesium).

## Instructions

Clone this repo and install [Node.js](http://nodejs.org/).  From the root directory of this repo, run:

```
npm install

node bin/3d-tiles-samples-generator.js
```

This commands generates a set of tilesets and saves them in a folder called `output`. The `Batched`, `Composite`, `Instanced`, `PointCloud`, and `Tilesets` folders may be copied directly to Cesium's `Specs/Data/Cesium3DTiles/` folder for testing with Cesium. The tilesets in the `Samples` folder may be copied to the `tilesets` folder in `3d-tiles-samples`.

Run the tests:
```
npm run test
```
To run ESLint on the entire codebase, run:
```
npm run eslint
```
To run ESLint automatically when a file is saved, run the following and leave it open in a console window:
```
npm run eslint-watch
```

## Contributions

Pull requests are appreciated!  Please use the same [Contributor License Agreement (CLA)](https://github.com/AnalyticalGraphicsInc/cesium/blob/master/CONTRIBUTING.md) and [Coding Guide](https://github.com/AnalyticalGraphicsInc/cesium/blob/master/Documentation/Contributors/CodingGuide/README.md) used for [Cesium](http://cesiumjs.org/).

---

<p align="center">
<a href="http://cesiumjs.org/"><img src="doc/cesium.png" onerror="this.src='cesium.png'"/></a>
</p>
