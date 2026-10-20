/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the API when it runs on another host, e.g. https://api.srdcom.tuke.sk/api (default: /api). */
  readonly VITE_API_URL?: string;
}
