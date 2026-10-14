/// <reference types="vite/client" />

declare module "*.png" {
  const src: string;
  export default src;
}

declare const __BUILD_ID__: string;
declare const __BUILD_AT__: string;
