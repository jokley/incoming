import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createServer } from 'vite';

function replaceGlobal(t: TestContext, name: string, value: unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  });
}

test('optional assignment measurement preserves API requests', async (t) => {
  // Use Vite to handle import.meta.env and the real API client's module imports.
  const server = await createServer({
    configFile: false,
    envFile: false,
    logLevel: 'silent',
    define: {
      'import.meta.env.VITE_ASSIGNMENT_PERFORMANCE': JSON.stringify('true'),
      'import.meta.env.VITE_API_URL': JSON.stringify('/api'),
    },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  t.after(() => server.close());
  const { startAssignmentMeasurement } = await server.ssrLoadModule(
    '/src/app/services/assignmentPerformance.ts',
  ) as typeof import('./assignmentPerformance.ts');
  const { api } = await server.ssrLoadModule(
    '/src/app/services/api.ts',
  ) as typeof import('./api.ts');

  await t.test('available randomUUID starts measurement as before', (t) => {
    const operationId = '11111111-1111-4111-8111-111111111111';
    const randomUUID = t.mock.fn(() => operationId);
    replaceGlobal(t, 'crypto', { randomUUID });
    replaceGlobal(t, 'window', {});
    replaceGlobal(t, 'document', { getElementsByTagName: () => [] });

    const measurement = startAssignmentMeasurement('/assignments/planning-view', 'GET');

    assert.ok(measurement);
    assert.equal(measurement.operationId, operationId);
    assert.ok(Number.isFinite(measurement.startedAt));
    assert.equal(randomUUID.mock.callCount(), 1);
  });

  for (const crypto of [{}, undefined]) {
    await t.test(`requests proceed with ${crypto ? 'missing randomUUID' : 'missing crypto'}`, async (t) => {
      replaceGlobal(t, 'crypto', crypto);
      // No DOM stubs: skipped measurement must not touch browser instrumentation.
      assert.equal(startAssignmentMeasurement('/assignments/planning-view', 'GET'), null);

      const planning = {
        timeline: { startDate: null, endDate: null },
        units: { unassigned: [], assigned: [] },
        hotels: [],
        validationByUnit: {},
      };
      const fetchMock = t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) =>
        Response.json(String(input).includes('/assignments/') ? planning : []),
      );

      const results = await Promise.all([
        api.getAssignmentPlanningView(),
        api.getOfficialQuotaUsage(),
      ]);

      assert.deepEqual(results, [planning, []]);
      assert.deepEqual(fetchMock.mock.calls.map(({ arguments: args }) => args[0]), [
        '/api/assignments/planning-view?includeValidations=false',
        '/api/fis/official-quotas',
      ]);
    });
  }
});
