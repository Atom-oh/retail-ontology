declare module 'cytoscape-fcose' {
  // No upstream types as of v2.2; cytoscape.use() accepts a simple plugin fn.
  const fcose: (cy: unknown) => void;
  export default fcose;
}
