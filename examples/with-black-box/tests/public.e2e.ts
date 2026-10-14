import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('the public home page loads successfully', async ({
  app,
  screen,
}) => {
  await app.open('/');

  await expect(screen.getByRole('textbox', 'Username')).toBeVisible();
  await expect(screen.getByRole('textbox', 'Password')).toBeVisible();
  await expect(screen.getByRole('button', 'Login')).toBeVisible();
});

