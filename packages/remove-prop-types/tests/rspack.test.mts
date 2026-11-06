import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  rspackHosts,
  buildPluginFixture,
  assertSourceMapping,
} from '@shakacode/swc-plugin-test-utils/rspack';
import { executeCommonJS } from '@shakacode/swc-plugin-test-utils/plugin';

const plugin = fileURLToPath(new URL('../plugin.wasm', import.meta.url));
const fixture = `
import PT from 'prop-types';
export function Component() { return 'retained'; }
Component.propTypes = { field: PT.string, nested: PT.shape({ value: PT.number }) };
export const marker = new Error('retained_marker');
`;

for (const { name: endpoint, createCompiler } of rspackHosts) {
  test(`one Wasm artifact works on the ${endpoint} supported Rspack`, async (t) => {
    const { code, map } = await buildPluginFixture(t, {
      createCompiler,
      plugin,
      source: fixture,
      externals: { 'prop-types': 'commonjs prop-types' },
    });
    const value = executeCommonJS(code, {
      require: () => {
        throw new Error('Unused validator dependency was loaded');
      },
    });
    const component = value.Component as (() => string) & { propTypes?: unknown };
    assert.equal(component(), 'retained');
    assert.equal(component.propTypes, undefined);
    assert.ok(!code.includes('prop-types'), 'validator dependency should leave the bundle');
    assertSourceMapping(code, map, fixture, 'retained_marker');
  });
}
