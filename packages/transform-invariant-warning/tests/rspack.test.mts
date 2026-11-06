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
import warn from 'warning';
import { warning as notify, invariant as check } from 'hey-listen';
import assertCondition = require('tiny-invariant');
let checks = 0;
warn(false, missing());
notify(false, missing());
check(checks++, missing());
assertCondition(++checks, missing());
if (checks) check(true, missing()); else throw new Error('wrong branch');
export { checks };
export const marker = new Error('retained_marker');
`;

for (const { name: endpoint, createCompiler } of rspackHosts) {
  test(`one Wasm artifact works on the ${endpoint} supported Rspack`, async (t) => {
    const { code, map } = await buildPluginFixture(t, {
      createCompiler,
      plugin,
      source: fixture,
      externals: {
        warning: 'commonjs warning',
        'hey-listen': 'commonjs hey-listen',
        'tiny-invariant': 'commonjs tiny-invariant',
      },
    });
    const calls: unknown[][] = [];
    const fn = (...args: unknown[]) => calls.push(args);
    const value = executeCommonJS(code, {
      require: () =>
        Object.assign(fn, { __esModule: true, default: fn, warning: fn, invariant: fn }),
    });
    assert.deepEqual(calls, [[false]]);
    assert.equal(value.checks, 2);
    assertSourceMapping(code, map, fixture, 'retained_marker');
  });
}
