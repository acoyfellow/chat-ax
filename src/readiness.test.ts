import { describe, expect, test } from 'bun:test';
import { readinessStatus } from './readiness';

const readyEnvironment = {
  ROOM: {},
  AGENT: {},
  CONNECTOR_VAULT: {},
  FILES: {},
  AI: {},
  CF_ACCESS_ISS: 'configured',
  CF_ACCESS_AUD: 'configured',
  AUTHORITY_RELEASE: 'release-id',
  BUILD_ID: 'build-id',
};

describe('non-sensitive readiness', () => {
  test('reports only fixed public fields when required configuration exists', () => {
    expect(readinessStatus(readyEnvironment)).toEqual({
      status: 'ready',
      service: 'chat-ax',
      release: 'release-id',
      build: 'build-id',
      schema: 5,
    });
  });

  test('fails closed without naming missing bindings', () => {
    const { AGENT: _agent, ...incomplete } = readyEnvironment;
    expect(readinessStatus(incomplete)).toEqual({
      status: 'not-ready',
      service: 'chat-ax',
      release: 'release-id',
      build: 'build-id',
      schema: 5,
    });
  });
});
