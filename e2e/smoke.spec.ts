import { expect, test } from '@playwright/test';

const unique = () => `e2e${Date.now()}${Math.floor(Math.random() * 1000)}`;

test('student registers, lands on the dashboard and cannot open admin pages', async ({ page }) => {
  const id = unique();
  await page.goto('/#/register');
  await page.getByLabel('Full name').fill('E2E Student');
  await page.getByLabel('Institutional email').fill(`${id}@example.edu`);
  await page.getByLabel('Department').fill('CSE');
  await page.getByLabel('Student / staff ID').fill(id);
  await page.getByLabel('Password').fill('Strong-Pass-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(/Hello, E2E/)).toBeVisible();
  await page.goto('/#/admin_users');
  await expect(page.getByText('Access denied')).toBeVisible();
});

test('admin signs in and sees the administration overview', async ({ page }) => {
  await page.goto('/#/login');
  await page.getByLabel('Email').fill('e2e-admin@example.edu');
  await page.getByLabel('Password').fill('E2e-Admin-Pass-1');
  await page.locator('form').getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible();
});
