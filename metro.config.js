const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// pnpm's Windows virtual store contains hard-linked regular files. Metro's
// file-map currently calls readlink on those entries and throws EINVAL before
// bundling starts. The hoisted install exposes runtime packages at the normal
// node_modules root, so the virtual store itself should not be watched.
config.resolver.blockList = [/node_modules[\\/]\.pnpm[\\/].*/];

module.exports = config;
