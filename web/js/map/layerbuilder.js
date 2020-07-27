/* eslint-disable import/no-duplicates */
import OlTileGridWMTS from 'ol/tilegrid/WMTS';
import { createXYZ } from 'ol/tilegrid';
import XYZ from 'ol/source/XYZ';

import OlSourceWMTS from 'ol/source/WMTS';
import OlSourceTileWMS from 'ol/source/TileWMS';
import OlLayerGroup from 'ol/layer/Group';
import OlLayerTile from 'ol/layer/Tile';
import OlTileGridTileGrid from 'ol/tilegrid/TileGrid';
import MVT from 'ol/format/MVT';
import LayerVectorTile from 'ol/layer/VectorTile';
import SourceVectorTile from 'ol/source/VectorTile';
import lodashCloneDeep from 'lodash/cloneDeep';
import lodashMerge from 'lodash/merge';
import lodashEach from 'lodash/each';
import lodashGet from 'lodash/get';
import util from '../util/util';
import lookupFactory from '../ol/lookupimagetile';
import { createVectorUrl, mergeBreakpointLayerAttributes } from './util';
import { datesinDateRanges, prevDateInDateRange } from '../modules/layers/util';
import {
  isActive as isPaletteActive,
  getKey as getPaletteKeys,
  getLookup as getPaletteLookup,
} from '../modules/palettes/selectors';
import {
  isActive as isVectorStyleActive,
  getKey as getVectorStyleKeys,
  applyStyle,
} from '../modules/vector-styles/selectors';
import {
  nearestInterval,
} from '../modules/layers/util';

export default function mapLayerBuilder(models, config, cache, ui, store) {
  const self = {};

  self.init = function() {
    self.extentLayers = [];
  };

  /**
   * Return a layer, or layergroup, created with the supplied function
   * @param {*} createLayerFunc
   * @param {*} def
   * @param {*} options
   * @param {*} attributes
   * @param {*} wrapLayer
   */
  const getLayer = (createLayerFunc, def, options, attributes, wrapLayer) => {
    const state = store.getState();
    const layer = createLayerFunc(def, options, null, state, attributes);
    if (!wrapLayer) {
      return layer;
    }
    const layerNext = createLayerFunc(def, options, 1, state, attributes);
    const layerPrior = createLayerFunc(def, options, -1, state, attributes);
    layer.wv = attributes;
    layerPrior.wv = attributes;
    layerNext.wv = attributes;
    return new OlLayerGroup({
      layers: [layer, layerNext, layerPrior],
    });
  };

  /**
   * For subdaily layers, if the layer date is within 30 minutes of current
   * time, set expiration to ten minutes from now
   */
  const getCacheOptions = (period, date, state) => {
    const tenMin = 10 * 60000;
    const thirtyMin = 30 * 60000;
    const now = new Date().getTime();
    const recentTime = Math.abs(now - date.getTime()) < thirtyMin;
    if (period !== 'subdaily' || !recentTime) {
      return {};
    }
    return {
      expirationAbsolute: new Date(now + tenMin),
    };
  };

  /**
   * Create a new OpenLayers Layer
   *
   * @method createLayer
   * @static
   * @param {object} def - Layer Specs
   * @param {object} options - Layer options
   * @returns {object} OpenLayers layer
   */
  self.createLayer = function(def, options) {
    const state = store.getState();
    const activeDateStr = state.compare.isCompareA ? 'selected' : 'selectedB';
    options = options || {};
    const group = options.group || null;
    const { closestDate, nextDate, previousDate } = self.getRequestDates(def, options);
    let date = closestDate;
    if (date) {
      options.date = date;
    }
    const key = self.layerKey(def, options, state);
    const proj = state.proj.selected;
    let layer = cache.getItem(key);

    if (!layer) {
      // layer is not in the cache
      if (!date) date = options.date || state.date[activeDateStr];
      const cacheOptions = getCacheOptions(def.period, date, state);
      const attributes = {
        id: def.id,
        key,
        date,
        proj: proj.id,
        def,
        group,
        nextDate,
        previousDate,
      };
      def = lodashCloneDeep(def);
      lodashMerge(def, def.projections[proj.id]);
      if (def.breakPointLayer) def = mergeBreakpointLayerAttributes(def, proj.id);

      // const wrapLayer = proj.id === 'geographic' && (def.wrapadjacentdays === true || def.wrapX);
      const wrapLayer = false;
      switch (def.type) {
        case 'wmts':
          layer = getLayer(createLayerWMTS, def, options, attributes, wrapLayer);
          break;
        case 'vector':
          layer = getLayer(createLayerVector, def, options, attributes, wrapLayer);
          break;
        case 'wms':
          layer = getLayer(createLayerWMS, def, options, attributes, wrapLayer);
          break;
        default:
          throw new Error(`Unknown layer type: ${def.type}`);
      }
      layer.wv = attributes;
      cache.setItem(key, layer, cacheOptions);
      layer.setVisible(false);
    }
    layer.setOpacity(def.opacity || 1.0);
    return layer;
  };

  /**
   * Returns the closest date, from the layer's array of availableDates
   *
   * @param  {object} def     Layer definition
   * @param  {object} options Layer options
   * @return {object}         Closest date
   */
  self.getRequestDates = function(def, options) {
    const state = store.getState();
    const activeDateStr = state.compare.isCompareA ? 'selected' : 'selectedB';
    const stateCurrentDate = new Date(state.date[activeDateStr]);
    const previousLayer = options.previousLayer || {};
    let date = options.date || stateCurrentDate;
    let previousDateFromRange;
    let previousLayerDate = previousLayer.previousDate;
    let nextLayerDate = previousLayer.nextDate;
    if (!state.animation.isPlaying) {
      // need to get previous available date to prevent unnecessary requests
      let dateRange;
      if (previousLayer.previousDate && previousLayer.nextDate) {
        const dateTime = date.getTime();
        const previousDateTime = previousLayer.previousDate.getTime();
        const nextDateTime = previousLayer.nextDate.getTime();
        // if current date is outside previous and next dates available, recheck range
        if (dateTime <= previousDateTime || dateTime >= nextDateTime) {
          dateRange = datesinDateRanges(def, date);
          const { next, previous } = prevDateInDateRange(def, date, dateRange);
          previousDateFromRange = previous;
          previousLayerDate = previous;
          nextLayerDate = next;
        } else {
          previousDateFromRange = previousLayer.previousDate;
        }
      } else {
        dateRange = datesinDateRanges(def, date);
        const { next, previous } = prevDateInDateRange(def, date, dateRange);
        previousDateFromRange = previous;
        previousLayerDate = previous;
        nextLayerDate = next;
      }
    }

    if (def.period === 'subdaily') {
      date = nearestInterval(def, date);
    } else if (previousDateFromRange) {
      date = util.clearTimeUTC(previousDateFromRange);
    } else {
      date = util.clearTimeUTC(date);
    }

    return { closestDate: date, previousDate: previousLayerDate, nextDate: nextLayerDate };
  };

  /**
   * Create a layer key
   *
   * @function layerKey
   * @static
   * @param {Object} def - Layer properties
   * @param {number} options - Layer options
   * @param {boolean} precache
   * @returns {object} layer key Object
   */
  self.layerKey = function(def, options, state) {
    const { compare } = state;
    let date;
    const layerId = def.id;
    const projId = state.proj.id;
    let style = '';
    const activeGroupStr = options.group ? options.group : compare.activeString;

    // Don't key by time if this is a static layer--it is valid for
    // every date.
    if (def.period) {
      date = util.toISOStringSeconds(util.roundTimeOneMinute(options.date));
    }
    if (isPaletteActive(def.id, activeGroupStr, state)) {
      style = getPaletteKeys(def.id, undefined, state);
    }
    if (isVectorStyleActive(def.id, activeGroupStr, state)) {
      style = getVectorStyleKeys(def.id, undefined, state);
    }
    return [layerId, projId, date, style, activeGroupStr].join(':');
  };

  /**
   * Determine the extent based on TileMatrixSetLimits defined in GetCapabilities response
   * @param {*} matrixSet - from GetCapabilities
   * @param {*} matrixSetLimits - from GetCapabilities
   * @param {*} day
   * @param {*} proj - current projection
   */
  const calcExtentsFromLimits = (matrixSet, matrixSetLimits, day, proj) => {
    let extent; let
      origin;

    switch (day) {
      case 1:
        extent = [-250, -90, -180, 90];
        origin = [-540, 90];
        break;
      case -1:
        extent = [180, -90, 250, 90];
        origin = [180, 90];
        break;
      default:
        extent = proj.maxExtent;
        origin = [extent[0], extent[3]];
        break;
    }

    const resolutionLen = matrixSet.resolutions.length;
    const setlimitsLen = matrixSetLimits && matrixSetLimits.length;

    // If number of set limits doesn't match sets, we are assuming this product
    // crosses the antimeridian and don't have a reliable way to calculate a single
    // extent based on multiple set limits.
    if (!matrixSetLimits || setlimitsLen !== resolutionLen || day) {
      return { origin, extent };
    }

    const limitIndex = resolutionLen - 1;
    const resolution = matrixSet.resolutions[limitIndex];
    const tileWidth = matrixSet.tileSize[0] * resolution;
    const tileHeight = matrixSet.tileSize[1] * resolution;
    const {
      minTileCol,
      maxTileRow,
      maxTileCol,
      minTileRow,
    } = matrixSetLimits[limitIndex];
    const minX = extent[0] + (minTileCol * tileWidth);
    const minY = extent[3] - ((maxTileRow + 1) * tileHeight);
    const maxX = extent[0] + ((maxTileCol + 1) * tileWidth);
    const maxY = extent[3] - (minTileRow * tileHeight);

    return {
      origin,
      extent: [minX, minY, maxX, maxY],
    };
  };

  /**
   * Create a new WMTS Layer
   * @method createLayerWMTS
   * @static
   * @param {object} def - Layer Specs
   * @param {object} options - Layer options
   * @returns {object} OpenLayers WMTS layer
   */
  const createLayerWMTS = function(def, options, day, state) {
    const activeDateStr = state.compare.isCompareA ? 'selected' : 'selectedB';
    const proj = state.proj.selected;
    const source = config.sources[def.source];
    if (def.id === 'basic') {
      const xyzsource = new XYZ({
        projection: 'EPSG:4326',
        url: 'http://localhost:8080/geographic/map.{z}/{x}/{y}.png',
      });
      return new OlLayerTile({
        preload: Infinity,
        source: xyzsource,
      });
    }
    const matrixSet = source.matrixSets[def.matrixSet];
    if (!matrixSet) {
      throw new Error(`${def.id}: Undefined matrix set: ${def.matrixSet}`);
    }
    let date = options.date || state.date[activeDateStr];
    if (def.period === 'subdaily' && !date) {
      date = self.getRequestDates(def, options).closestDate;
      date = new Date(date.getTime());
    }
    if (day && def.wrapadjacentdays && def.period !== 'subdaily') {
      date = util.dateAdd(date, 'day', day);
    }
    const { tileMatrices, resolutions, tileSize } = matrixSet;
    const { origin, extent } = calcExtentsFromLimits(matrixSet, def.matrixSetLimits, day, proj);
    const sizes = !tileMatrices ? [] : tileMatrices.map(({ matrixWidth, matrixHeight }) => [matrixWidth, -matrixHeight]);
    const tileGridOptions = {
      origin,
      extent,
      sizes,
      resolutions,
      matrixIds: def.matrixIds || resolutions.map((set, index) => index),
      tileSize: tileSize[0],
    };
    console.log(matrixSet);
    console.log(tileMatrices);
    const urlParameters = `?TIME=${util.toISOStringSeconds(util.roundTimeOneMinute(date))}`;
    // if (!source.url) source.url = 'http://localhost:8080/styles';

    const sourceOptions = {
      url: source.url + urlParameters,
      layer: def.layer || def.id,
      cacheSize: 4096,
      crossOrigin: 'anonymous',
      format: def.format,
      transition: 0,
      matrixSet: matrixSet.id,
      tileGrid: new OlTileGridWMTS(tileGridOptions),
      wrapX: false,
      style: typeof def.style === 'undefined' ? 'default' : def.style,
    };
    if (isPaletteActive(def.id, options.group, state)) {
      const lookup = getPaletteLookup(def.id, options.group, state);
      sourceOptions.tileClass = lookupFactory(lookup, sourceOptions);
    }
    const xyzsource = new XYZ({
      url: 'http://localhost:8080/tile/{z}/{x}/{y}.png',
    });
    return new OlLayerTile({
      preload: Infinity,
      extent,
      source: source.url ? new OlSourceWMTS(sourceOptions) : xyzsource,
    });
  };

  /**
    *
    * @param {object} def - Layer Specs
    * @param {object} options - Layer options
    * @param {number} day
    * @param {object} state
    * @param {object} attributes
    */
  const createLayerVector = function(def, options, day, state, attributes) {
    const { proj, compare } = state;
    let date;
    let gridExtent;
    let matrixIds;
    let start;
    let layerExtent;
    const selectedProj = proj.selected;
    const activeDateStr = compare.isCompareA ? 'selected' : 'selectedB';
    const source = config.sources[def.source];
    gridExtent = selectedProj.maxExtent;
    layerExtent = gridExtent;
    start = [selectedProj.maxExtent[0], selectedProj.maxExtent[3]];

    if (!source) {
      throw new Error(`${def.id}: Invalid source: ${def.source}`);
    }
    const matrixSet = source.matrixSets[def.matrixSet];

    if (!matrixSet) {
      throw new Error(`${def.id}: Undefined matrix set: ${def.matrixSet}`);
    }
    if (typeof def.matrixIds === 'undefined') {
      matrixIds = [];
      lodashEach(matrixSet.resolutions, (resolution, index) => {
        matrixIds.push(index);
      });
    } else {
      matrixIds = def.matrixIds;
    }

    if (day) {
      if (day === 1) {
        layerExtent = [-250, -90, -180, 90];
        start = [-180, 90];
        gridExtent = [110, -90, 180, 90];
      } else {
        gridExtent = [-180, -90, -110, 90];
        layerExtent = [180, -90, 250, 90];
        start = [-180, 90];
      }
    }

    const layerName = def.layer || def.id;
    const tileMatrixSet = def.matrixSet;
    date = options.date || state.date[activeDateStr];

    if (day && def.wrapadjacentdays) date = util.dateAdd(date, 'day', day);
    const urlParameters = createVectorUrl(date, layerName, tileMatrixSet);
    const wrapX = !!(day === 1 || day === -1);
    const breakPointLayerDef = def.breakPointLayer;
    const breakPointResolution = lodashGet(def, 'breakPointLayer.resolutionBreakPoint');
    const breakPointType = lodashGet(def, 'breakPointLayer.breakPointType');
    const isMaxBreakPoint = breakPointType === 'max';
    const isMinBreakPoint = breakPointType === 'min';

    const sourceOptions = new SourceVectorTile({
      url: source.url + urlParameters,
      layer: layerName,
      day,
      format: new MVT(),
      matrixSet: tileMatrixSet,
      wrapX,
      tileGrid: new OlTileGridTileGrid({
        extent: gridExtent,
        resolutions: matrixSet.resolutions,
        tileSize: matrixSet.tileSize,
        origin: start,
        sizes: matrixSet.tileMatrices,

      }),
    });
    const layer = new LayerVectorTile({
      extent: layerExtent,
      source: sourceOptions,
      renderMode: 'image',
      preload: 10,
      ...isMaxBreakPoint && { maxResolution: breakPointResolution },
      ...isMinBreakPoint && { minResolution: breakPointResolution },
    });
    applyStyle(def, layer, state, options);
    layer.wrap = day;
    layer.wv = attributes;
    layer.isVector = true;
    if (breakPointLayerDef) {
      const newDef = { ...def, ...breakPointLayerDef };
      const wmsLayer = createLayerWMS(newDef, options, day, state);
      const layerGroup = new OlLayerGroup({
        layers: [layer, wmsLayer],
      });
      wmsLayer.wv = attributes;
      return layerGroup;
    }
    return layer;
  };

  /**
   * Create a new WMS Layer
   *
   * @method createLayerWMTS
   * @static
   * @param {object} def - Layer Specs
   * @param {object} options - Layer options
   * @returns {object} OpenLayers WMS layer
   */
  const createLayerWMS = function(def, options, day, state) {
    const { proj, compare } = state;
    const activeDateStr = compare.isCompareA ? 'selected' : 'selectedB';
    const selectedProj = proj.selected;
    let urlParameters;
    let date;
    let extent;
    let start;
    let res;

    const source = config.sources[def.source];
    extent = selectedProj.maxExtent;
    start = [selectedProj.maxExtent[0], selectedProj.maxExtent[3]];
    res = selectedProj.resolutions;
    if (!source) {
      throw new Error(`${def.id}: Invalid source: ${def.source}`);
    }

    const transparent = def.format === 'image/png';
    if (selectedProj.id === 'geographic') {
      res = [
        0.28125,
        0.140625,
        0.0703125,
        0.03515625,
        0.017578125,
        0.0087890625,
        0.00439453125,
        0.002197265625,
        0.0010986328125,
        0.00054931640625,
        0.00027465820313,
      ];
    }
    if (day) {
      if (day === 1) {
        extent = [-250, -90, -180, 90];
        start = [-540, 90];
      } else {
        extent = [180, -90, 250, 90];
        start = [180, 90];
      }
    }
    const parameters = {
      LAYERS: def.layer || def.id,
      FORMAT: def.format,
      // TRANSPARENT: transparent,
      VERSION: '1.1.1',
      EXCEPTIONS: 'application/vnd.ogc.se_inimage',
    };
    if (def.styles) {
      parameters.STYLES = def.styles;
    }

    urlParameters = '';

    // date = options.date || state.date[activeDateStr];
    // if (day && def.wrapadjacentdays) {
    //   date = util.dateAdd(date, 'day', day);
    // }
    // urlParameters = `?TIME=${util.toISOStringSeconds(util.roundTimeOneMinute(date))}`;
    const reso = [0.5625, 0.28125, 0.140625, 0.0703125, 0.03515625, 0.017578125, 0.0087890625, 0.00439453125, 0.002197265625, 0.0010986328125];
    if (def.id === '__all__') {
      const tileMatrices = [
        { matrixWidth: 2, matrixHeight: 1 },
        { matrixWidth: 3, matrixHeight: 2 },
        { matrixWidth: 5, matrixHeight: 3 },
        { matrixWidth: 10, matrixHeight: 5 },
        { matrixWidth: 40, matrixHeight: 10 },
        { matrixWidth: 48, matrixHeight: 32 },
        { matrixWidth: 80, matrixHeight: 48 },
        { matrixWidth: 160, matrixHeight: 80 },
        { matrixWidth: 321, matrixHeight: 161 },
        { matrixWidth: 640, matrixHeight: 320 },
      ];
      const sizesXYZ = tileMatrices.map(({ matrixWidth, matrixHeight }) => [matrixWidth, -matrixHeight]);

      const xyzsource = new XYZ({
        projection: 'EPSG:4326',
        url: `http://localhost:8080/${proj.id}/{z}/{y}/{x}.png`,
        tileSize: 512,
        minZoom: 1,
        extent: [-180, -90, 180, 90],
        // tileUrlFunction: (tileCoord, pixelRatio, projection) => {
        //   const z = tileCoord[0];
        //   const x = tileCoord[1];
        //   const y = -tileCoord[2] - 1;
        //   // const newY = Math.pow(2, z) - y - 1;
        //   return `http://localhost:8080/${proj.id}/${z}/${y}/${x}.png`;
        // },
        tileGrid: new OlTileGridTileGrid({
          resolutions: reso,
          tileSize: [512, 512],
          extent: [-180, -90, 180, 90],
          origin: [-180, 90],
          sizes: sizesXYZ,
        }),
        // maxResolution: 0.5625,
        // tilePixelRatio: 2,
      });
      console.log(xyzsource);
      return new OlLayerTile({
        preload: Infinity,
        source: xyzsource,
        extent: [-180, -90, 180, 90],
      });
    }
    const sourceOptions = {
      url: source.url + urlParameters,
      cacheSize: 4096,
      wrapX: true,
      style: 'default',
      crossOrigin: 'anonymous',
      params: parameters,
      transition: 0,
      tileGrid: new OlTileGridTileGrid({
        origin: [0, -180, -90],
        resolutions: res,
        extent: [
          -180,
          -90,
          180,
          90,
        ],
      }),
    };
    if (isPaletteActive(def.id, options.group, state)) {
      const lookup = getPaletteLookup(def.id, options.group, state);
      sourceOptions.tileClass = lookupFactory(lookup, sourceOptions);
    }
    const layer = new OlLayerTile({
      preload: Infinity,
      extent,
      ...!!def.resolutionBreakPoint && { minResolution: def.resolutionBreakPoint },
      source: new OlSourceTileWMS(sourceOptions),
    });
    return layer;
  };

  self.init();
  return self;
}
