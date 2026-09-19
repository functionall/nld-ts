// Vite's `?raw` suffix imports a file as a string. The conformance fixtures are loaded this way
// so that TypeScript does not infer a type from a megabyte of JSON.
declare module "*?raw" {
  const text: string;
  export default text;
}
