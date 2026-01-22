declare module '@deck.gl/core' {
  const deckGlCore: any;
  export default deckGlCore;
  export type Layer = any;
  export type LayerProps = any;
  export type Position = any;
  export type Color = any;
  export const Deck: any;
}

declare module '@deck.gl/layers' {
  export const ArcLayer: any;
  export const GeoJsonLayer: any;
  export const PathLayer: any;
  export const PolygonLayer: any;
  export const ScatterplotLayer: any;
  const defaultExport: any;
  export default defaultExport;
}

declare module '@deck.gl/layers/*' {
  const deckGlLayersSubmodule: any;
  export = deckGlLayersSubmodule;
}

declare module '@deck.gl/aggregation-layers' {
  export const HexagonLayer: any;
  export const ScreenGridLayer: any;
  export const GridLayer: any;
  export const HeatmapLayer: any;
  export const ContourLayer: any;
  const defaultExport: any;
  export default defaultExport;
}

declare module '@deck.gl/aggregation-layers/*' {
  const deckGlAggregationLayersSubmodule: any;
  export = deckGlAggregationLayersSubmodule;
}

declare module '@deck.gl/core/*' {
  const deckGlCoreSubmodule: any;
  export = deckGlCoreSubmodule;
}

declare module '@deck.gl/react' {
  const deckGlReact: any;
  export = deckGlReact;
}

declare module '@deck.gl/react/*' {
  const deckGlReactSubmodule: any;
  export = deckGlReactSubmodule;
}

declare module '@deck.gl/widgets' {
  const deckGlWidgets: any;
  export = deckGlWidgets;
}

declare module '@deck.gl/widgets/*' {
  const deckGlWidgetsSubmodule: any;
  export = deckGlWidgetsSubmodule;
}

