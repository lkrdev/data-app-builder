module.exports = function (api) {
  const envName = api.env();
  api.cache.using(() => envName);

  return {
    presets: [
      ['@babel/preset-env', { targets: envName === 'test' ? { node: 'current' } : { chrome: '105', firefox: '115', safari: '15.4' } }],
      '@babel/preset-react',
      '@babel/preset-typescript'
    ],
    plugins: [].filter(Boolean)
  };
};