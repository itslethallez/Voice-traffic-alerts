module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-reanimated/plugin (via react-native-worklets) must stay
    // last in the plugins list - it rewrites worklet functions, so any
    // plugin ordered after it would see already-transformed code.
    plugins: ['react-native-worklets/plugin'],
  };
};
