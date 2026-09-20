import { defineCloudflareConfig } from "@opennextjs/cloudflare";

const config = defineCloudflareConfig();

export default {
  ...config,
  default: {
    ...config.default,
    // esbuild minify rewrites Effect TypeId symbols to `symbol + ""`, which
    // throws in workerd. Keep the server bundle unminified. (Poppycock-proven
    // configuration on the same Next 16 / Effect 3.22 stack.)
    minify: false,
  },
};
