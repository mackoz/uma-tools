// Ambient declarations for esbuild `define` globals (umalator/build.mjs:44,
// umalator-global/build.mjs:122) -- tsc otherwise reports TS2552/TS2304 on
// every reference, since these identifiers exist only via esbuild's define
// substitution and have no source declaration. PIPE-58.
declare const CC_GLOBAL: boolean;
declare const CC_DEBUG: boolean;
