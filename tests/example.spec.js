const { test, expect } = require('@playwright/test');

test.describe('Basic Website Test', () => {
  test('should load website and verify title', async ({ page }) => {
    // Navigate to the website
    await page.goto('https://example.com');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Verify the page title
    await expect(page).toHaveTitle(/Example Domain/);
  });

  test('should verify page content', async ({ page }) => {
    // Navigate to the website
    await page.goto('https://alohaq.honolulu.gov/?1&cat=1&name=Driver%20Licensing%20and%20Satellite%20Services');
    
    // Verify that the page contains expected text
    await expect(page.locator('body')).toContainText('Example Domain');
    
    // Take a screenshot (optional)
    await page.screenshot({ path: 'screenshot.png' });
  });

  test('should interact with page elements', async ({ page }) => {
    // Navigate to the website
    await page.goto('https://example.com');
    
    // Find and click on a link (if available)
    const moreInfoLink = page.locator('text=More information...');
    if (await moreInfoLink.isVisible()) {
      await moreInfoLink.click();
      // Wait for navigation
      await page.waitForLoadState('networkidle');
    }
  });
});
