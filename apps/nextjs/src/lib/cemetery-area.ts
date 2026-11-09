import type { Place, Scope } from '@southview/validators';

// The cemetery grounds: the four Fulton County tax parcels of the South View Cemetery Association
// that the mapped cemetery covers (tax year 2027, retrieved 2026-11-06), merged into one outline of
// about 100.8 acres. The Association's 16 smaller lots nearby (across Jonesboro Road, on Browns Mill
// Road, Knox Drive and Merrilyn Drive) lie wholly outside both the mapped cemetery and the dated land
// survey, so they are left out. An ownership outline from public records, not a surveyed boundary.
export const cemeteryArea = {
  type: 'Feature' as const,
  properties: {
    name: 'South-View Cemetery',
    source: 'Fulton County, Georgia tax parcels',
    sourceUrl:
      'https://gismaps.fultoncountyga.gov/arcgispub/rest/services/OpenData/Tax_Parcels/MapServer',
    accessedAt: '2026-11-06',
  },
  geometry: {
    type: 'Polygon' as const,
    coordinates: [
      [
        [-84.3748124, 33.7022631],
        [-84.3765114, 33.7031318],
        [-84.3743487, 33.704871],
        [-84.3717475, 33.7026009],
        [-84.3688991, 33.7030185],
        [-84.3689086, 33.7049476],
        [-84.3673183, 33.7049325],
        [-84.3668911, 33.7041139],
        [-84.366687, 33.7038167],
        [-84.3663282, 33.7033994],
        [-84.3658885, 33.7030071],
        [-84.3645605, 33.7020743],
        [-84.3641657, 33.7017405],
        [-84.3650066, 33.7017325],
        [-84.3649886, 33.7000149],
        [-84.3681055, 33.6999854],
        [-84.3681808, 33.6996925],
        [-84.3684046, 33.6991361],
        [-84.3685229, 33.6987351],
        [-84.3714251, 33.6987493],
        [-84.3727779, 33.7002234],
        [-84.3741612, 33.7017719],
        [-84.3744478, 33.7020249],
        [-84.3748124, 33.7022631],
      ],
    ],
  },
};

const ring = cemeteryArea.geometry.coordinates[0]!;
export const cemeteryBounds: [[number, number], [number, number]] = [
  [Math.min(...ring.map(([lng]) => lng!)), Math.min(...ring.map(([, lat]) => lat!))],
  [Math.max(...ring.map(([lng]) => lng!)), Math.max(...ring.map(([, lat]) => lat!))],
];
export const cemeteryCenter: [number, number] = [
  (cemeteryBounds[0][0] + cemeteryBounds[1][0]) / 2,
  (cemeteryBounds[0][1] + cemeteryBounds[1][1]) / 2,
];

/** Explicit overview controls frame both city places and the full cemetery outline. */
export function overviewBounds(
  places: Pick<Place, 'coordinates'>[],
  scope: Scope,
): typeof cemeteryBounds {
  const points =
    scope === 'atlanta'
      ? [
          ...cemeteryBounds,
          ...places.flatMap((place) => (place.coordinates ? [place.coordinates] : [])),
        ]
      : cemeteryBounds;
  return [
    [Math.min(...points.map(([lng]) => lng)), Math.min(...points.map(([, lat]) => lat))],
    [Math.max(...points.map(([lng]) => lng)), Math.max(...points.map(([, lat]) => lat))],
  ];
}

/** Keep destinations visible beside floating panels, including short/phone viewports. */
export function mapPadding(
  width: number,
  height: number,
  detailOpen: boolean,
  resultsOpen: boolean,
) {
  if (width <= 760)
    return {
      top: Math.min(150, height * 0.23),
      bottom: detailOpen ? height * 0.59 : 105,
      left: 30,
      right: 60,
    };
  return {
    top: 150,
    bottom: 70,
    left: resultsOpen ? Math.min(390, width * 0.34) : 70,
    right: detailOpen ? Math.min(410, width * 0.35) : 70,
  };
}
