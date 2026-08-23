// Ambient declaration for side-effect CSS imports (esbuild bundles them; tsc
// otherwise reports TS2882 on every `import './x.css'` in the repo).
declare module '*.css';
