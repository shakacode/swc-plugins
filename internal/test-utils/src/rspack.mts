import earliest from 'rspack-earliest';
import latest from 'rspack-latest';

export type RspackConfiguration = import('rspack-earliest').Configuration &
  import('rspack-latest').Configuration;
export type RspackCompiler = import('rspack-earliest').Compiler | import('rspack-latest').Compiler;

export const rspackHosts = [
  {
    name: 'earliest',
    DefinePlugin: earliest.DefinePlugin,
    createCompiler: (config: RspackConfiguration) => earliest.rspack(config),
  },
  {
    name: 'latest',
    DefinePlugin: latest.DefinePlugin,
    createCompiler: (config: RspackConfiguration) => latest.rspack(config),
  },
] as const;

export function runCompiler(compiler: RspackCompiler): Promise<void> {
  return new Promise((resolve, reject) => {
    compiler.run((error, stats) => {
      compiler.close((closeError) => {
        if (error || closeError) {
          reject(error || closeError);
        } else if (!stats) {
          reject(new Error('Rspack did not return build statistics'));
        } else if (stats.hasErrors()) {
          reject(new Error(stats.toString({ all: false, errors: true })));
        } else {
          resolve();
        }
      });
    });
  });
}

export function closeCompiler(compiler: RspackCompiler): Promise<void> {
  return new Promise((resolve, reject) => {
    compiler.close((error) => (error ? reject(error) : resolve()));
  });
}
