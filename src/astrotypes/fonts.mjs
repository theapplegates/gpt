import { fontProviders } from "astro/config";

export const astrotypeFonts = [
  {
    provider: fontProviders.google(),
    name: "Geist",
    cssVariable: "--font-geist"
  }
];
