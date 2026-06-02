import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.yourstore.pos",
  appName: "YourStore POS",
  webDir: "dist",
  android: {
    allowMixedContent: false,
    backgroundColor: "#090d16",
  },
  server: {
    androidScheme: "https",
  },
};

export default config;
