import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";

const isWatching = !!process.env.ROLLUP_WATCH;
const sdPlugin = "com.eordouie.herdrdeck.sdPlugin";

// The two plugin UUIDs have separate entry points and output directories.
// They share the renderer and the process-capture helper.
/** @type {import('rollup').RollupOptions} */
export default {
  input: "src/herdr-deck/plugin.ts",
  output: {
    file: `${sdPlugin}/bin/plugin.js`,
    inlineDynamicImports: true,
    sourcemap: isWatching,
  },
  plugins: [
    typescript({ tsconfig: "tsconfig.herdr-deck.json" }),
    nodeResolve({
      browser: false,
      exportConditions: ["node"],
      preferBuiltins: true,
      extensions: [".ts", ".js", ".mjs", ".json"],
    }),
    commonjs(),
    !isWatching && terser(),
    {
      name: "emit-module-package-file",
      generateBundle() {
        this.emitFile({ fileName: "package.json", source: `{ "type": "module" }`, type: "asset" });
      },
    },
  ],
};
