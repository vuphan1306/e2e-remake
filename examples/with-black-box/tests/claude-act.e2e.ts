import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('Claude can complete the demo login flow', async ({ app, agent, screen }) => {
  await app.open('/');

  await agent.act(
    'Log in with username "standard_user" and password "secret_sauce". Stop after the products page is visible.',
  );

  await expect(screen.getByText('Products')).toBeVisible();
});

