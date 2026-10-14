import { test } from '@e2e-dev/web';

test('Claude can judge the loaded login page', async ({ app, agent }) => {
  await app.open('/');
  await agent.assert(
    'The Swag Labs login page is visible with username, password, and login controls.',
  );
});

