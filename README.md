# 3D Tiles Samples Generator

> **A note about the repository structure**
> 
> This repository was originally part of the `3d-tiles-validator` repository, which contained multiple projects. Now, these project are maintained in separate repositories:
> 
> - The `3d-tiles-validator` can be found in [the `3d-tiles-validator` repository](https://github.com/CesiumGS/3d-tiles-validator)
> - The `3d-tiles-tools` can be found in [the `3d-tiles-tools` repository](https://github.com/CesiumGS/3d-tiles-tools)
> 


The tilesets generated here are included in [3d-tiles-samples](https://github.com/CesiumGS/3d-tiles-samples) and [Cesium](https://github.com/CesiumGS/cesium).

## Instructions

Clone this repo and install [Node.js](http://nodejs.org/).  From this directory, run:

```
npm install

npm run build

cd dist/

node bin/3d-tiles-samples-generator.js
```

This commands generates a set of tilesets and saves them in a folder called `output`. The `Batched`, `Composite`, `Instanced`, `PointCloud`, and `Tilesets` folders may be copied directly to CesiumJS's `Specs/Data/Cesium3DTiles/` folder for testing with CesiumJS. The tilesets in the `Samples` folder may be copied to the `tilesets` folder in `3d-tiles-samples`.

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

## Auto Recompilation
You can use
```
npm run watch
```

to automatically recompile your changes while editing.

## License

Tilesets generated by this tool are licensed under [CC0](https://creativecommons.org/share-your-work/public-domain/cc0/) with the following exceptions:

* `TilesetWithRequestVolume` is licensed under a [Creative Commons Attribution 3.0 Unported License](https://creativecommons.org/licenses/by/3.0/). The building model was created by Richard Edwards: http://www.blendswap.com/blends/view/45211.

## Contributions

Pull requests are appreciated!  Please use the same [Contributor License Agreement (CLA)](https://github.com/CesiumGS/cesium/blob/main/CONTRIBUTING.md) and [Coding Guide](https://github.com/CesiumGS/cesium/blob/main/Documentation/Contributors/CodingGuide/README.md) used for [CesiumJS](https://cesium.com/cesiumjs/).

---

<p align="center">
<a href="https://cesium.com/"><img src="doc/cesium.png" onerror="this.src='cesium.png'"/></a>
</p>
