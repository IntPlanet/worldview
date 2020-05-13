import BooleanFacet from '../../components/layer/product-picker/search/boolean-facet';

// import {
//   BooleanFacet,
// } from '@elastic/react-search-ui-views';

export default [
  {
    field: 'availableAtDate',
    label: 'Available',
    filterType: 'boolean',
    tooltip: 'Layer has available imagery at currently selected date/time',
    view: BooleanFacet,
    useLabelForValue: true,
    hideZeroCount: true,
  },
  {
    field: 'categories',
    label: 'Category',
    filterType: 'any',
    tooltip: 'Hazards and Disasters, Science Disciplines and Featured Categories',
    show: 20,
    hideZeroCount: true,
  },
  {
    field: 'measurements',
    label: 'Measurements',
    filterType: 'any',
    tooltip: 'Scientific Measurements',
    show: 5,
    hideZeroCount: true,
  },
  {
    field: 'sources',
    label: 'Source',
    filterType: 'any',
    tooltip: 'Satellite and sensor/instrument',
    hideZeroCount: true,
  },
  {
    field: 'facetPeriod',
    label: 'Period',
    filterType: 'any',
    tooltip: 'Temporal Resolution',
    hideZeroCount: true,
  },
  {
    field: 'daynight',
    label: 'Track Day/Night',
    filterType: 'any',
    tooltip: 'Whether the satellite orbit track passes over during the daytime or nighttime',
    hideZeroCount: true,
  },
];