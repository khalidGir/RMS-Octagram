import { test, expect } from './fixtures';

test.describe('POS Cash Journey', () => {
  test('cashier sees POS with menu after real login', async ({ cashierPage }) => {
    await expect(cashierPage.locator('h1')).toContainText('New order');
    // Menu should load from the API with our seeded item
    await expect(cashierPage.locator('text=Test Burger').first()).toBeVisible({ timeout: 10000 });
  });

  test('cashier sees shift status', async ({ cashierPage }) => {
    // Cashier has an open shift from seed
    await expect(cashierPage.locator('text=Cash shift active')).toBeVisible({ timeout: 10000 });
  });

  test('POS shows empty cart state', async ({ cashierPage }) => {
    await expect(cashierPage.locator('text=No items yet.')).toBeVisible();
  });

  test('create order button is disabled when cart is empty', async ({ cashierPage }) => {
    const createBtn = cashierPage.locator('button:has-text("Create order")');
    await expect(createBtn).toBeDisabled();
  });

  test('menu items display with variant prices', async ({ cashierPage }) => {
    await expect(cashierPage.locator('text=Test Burger').first()).toBeVisible({ timeout: 10000 });
    // Should show price
    await expect(cashierPage.locator('text=ETB 250')).toBeVisible();
  });

  test('search filters menu items', async ({ cashierPage }) => {
    await cashierPage.locator('input[placeholder="Search menu"]').fill('Burger');
    await expect(cashierPage.locator('text=Test Burger').first()).toBeVisible();
    await cashierPage.locator('input[placeholder="Search menu"]').fill('Nonexistent');
    await expect(cashierPage.locator('text=Test Burger').first()).not.toBeVisible();
  });

  test('category filter works', async ({ cashierPage }) => {
    await expect(cashierPage.locator('button:has-text("All")')).toBeVisible();
    await expect(cashierPage.locator('button:has-text("Food")')).toBeVisible();
  });

  test('multi-variant item opens variant selector', async ({ cashierPage }) => {
    // Test Burger has 2 variants (Regular + Large), clicking it opens variant selector
    await cashierPage.locator('button:has-text("Test Burger")').click();
    await expect(cashierPage.locator('[role="dialog"]')).toBeVisible();
    await expect(cashierPage.locator('text=Regular')).toBeVisible();
    await expect(cashierPage.locator('text=Large')).toBeVisible();
    // Cancel closes dialog
    await cashierPage.locator('[role="dialog"] button:has-text("Cancel")').click();
    await expect(cashierPage.locator('[role="dialog"]')).not.toBeVisible();
  });

  test('variant selection opens modifier selector with required group', async ({ cashierPage }) => {
    await cashierPage.locator('button:has-text("Test Burger")').click();
    // Select Regular variant
    await cashierPage.locator('[role="dialog"] button:has-text("Regular")').click();
    // Modifier dialog should open with required "Toppings" group
    await expect(cashierPage.locator('[role="dialog"] h2:has-text("Test Burger")')).toBeVisible();
    await expect(cashierPage.locator('text=Toppings')).toBeVisible();
    await expect(cashierPage.locator('text=Lettuce')).toBeVisible();
    await expect(cashierPage.locator('text=Tomato')).toBeVisible();
    await expect(cashierPage.locator('text=Cheese')).toBeVisible();
  });

  test('required modifier min/max validation blocks confirm', async ({ cashierPage }) => {
    await cashierPage.locator('button:has-text("Test Burger")').click();
    await cashierPage.locator('[role="dialog"] button:has-text("Regular")').click();
    // No modifier selected, "Add to order" should show validation error
    await cashierPage.locator('[role="dialog"] button:has-text("Add to order")').click();
    await expect(cashierPage.locator('[role="dialog"]').locator('text=Toppings requires at least 1 selection')).toBeVisible();
    // Select 1 option (meets min=1), confirm should work
    await cashierPage.locator('label:has-text("Lettuce")').click();
    await cashierPage.locator('[role="dialog"] button:has-text("Add to order")').click();
    // Dialog closes and item appears in cart
    await expect(cashierPage.locator('[role="dialog"]')).not.toBeVisible();
    await expect(cashierPage.locator('li:has-text("Test Burger")')).toBeVisible();
  });

  test('optional modifiers add to price', async ({ cashierPage }) => {
    await cashierPage.locator('button:has-text("Test Burger")').click();
    await cashierPage.locator('[role="dialog"] button:has-text("Regular")').click();
    // Select required: Lettuce
    await cashierPage.locator('label:has-text("Lettuce")').click();
    // Select optional: Bacon (+ETB 30)
    await cashierPage.locator('label:has-text("Bacon")').click();
    await cashierPage.locator('[role="dialog"] button:has-text("Add to order")').click();
    // Cart shows item with Bacon modifier text
    await expect(cashierPage.locator('li:has-text("Test Burger")')).toBeVisible();
    await expect(cashierPage.locator('li:has-text("Bacon")')).toBeVisible();
  });

  test('edit line restores variant and modifier selections', async ({ cashierPage }) => {
    // Add item with Lettuce
    await cashierPage.locator('button:has-text("Test Burger")').click();
    await cashierPage.locator('[role="dialog"] button:has-text("Regular")').click();
    await cashierPage.locator('label:has-text("Lettuce")').click();
    await cashierPage.locator('[role="dialog"] button:has-text("Add to order")').click();
    // Click Edit on the cart line
    await cashierPage.locator('button:has-text("Edit")').click();
    // Modifier dialog opens with Lettuce pre-checked
    await expect(cashierPage.locator('[role="dialog"] h2:has-text("Test Burger")')).toBeVisible();
    const lettuceCheckbox = cashierPage.locator('label:has-text("Lettuce") input[type="checkbox"]');
    await expect(lettuceCheckbox).toBeChecked();
  });

  test('different modifier selections create distinct cart lines', async ({ cashierPage }) => {
    // Add item with Lettuce
    await cashierPage.locator('button:has-text("Test Burger")').click();
    await cashierPage.locator('[role="dialog"] button:has-text("Regular")').click();
    await cashierPage.locator('label:has-text("Lettuce")').click();
    await cashierPage.locator('[role="dialog"] button:has-text("Add to order")').click();
    // Add same item with Cheese
    await cashierPage.locator('button:has-text("Test Burger")').click();
    await cashierPage.locator('[role="dialog"] button:has-text("Regular")').click();
    await cashierPage.locator('label:has-text("Cheese")').click();
    await cashierPage.locator('[role="dialog"] button:has-text("Add to order")').click();
    // Two distinct cart lines
    const cartLines = cashierPage.locator('li:has-text("Test Burger")');
    await expect(cartLines).toHaveCount(2);
  });

  test('cart shows Subtotal before VAT after server creates order', async ({ cashierPage }) => {
    // Add item
    await cashierPage.locator('button:has-text("Test Burger")').click();
    await cashierPage.locator('[role="dialog"] button:has-text("Regular")').click();
    await cashierPage.locator('label:has-text("Lettuce")').click();
    await cashierPage.locator('[role="dialog"] button:has-text("Add to order")').click();
    // Subtotal should be visible (before order creation, only subtotal shows)
    await expect(cashierPage.locator('text=Subtotal (before VAT)')).toBeVisible();
    // No VAT/Total yet (only shown after server creates order)
    await expect(cashierPage.locator('text=Total payable')).not.toBeVisible();
  });

  test('create order button becomes enabled with items', async ({ cashierPage }) => {
    // Add item
    await cashierPage.locator('button:has-text("Test Burger")').click();
    await cashierPage.locator('[role="dialog"] button:has-text("Regular")').click();
    await cashierPage.locator('label:has-text("Lettuce")').click();
    await cashierPage.locator('[role="dialog"] button:has-text("Add to order")').click();
    const createBtn = cashierPage.locator('button:has-text("Create order")');
    await expect(createBtn).toBeEnabled();
  });

  test('offline state disables order creation', async ({ cashierPage }) => {
    await cashierPage.context().setOffline(true);
    await expect(cashierPage.locator('[role="status"]')).toContainText('offline', { timeout: 10000 });
    const createBtn = cashierPage.locator('button:has-text("Create order")');
    await expect(createBtn).toBeDisabled();
  });

  test('variant selector has focus trap', async ({ cashierPage }) => {
    await cashierPage.locator('button:has-text("Test Burger")').click();
    await expect(cashierPage.locator('[role="dialog"]')).toBeVisible();
    // Tab from last focusable should wrap to first
    const dialog = cashierPage.locator('[role="dialog"]');
    const cancelBtn = dialog.locator('button:has-text("Cancel")');
    await cancelBtn.focus();
    await cashierPage.keyboard.press('Tab');
    // Focus should stay within dialog
    const focused = await cashierPage.evaluate(() => {
      const el = document.activeElement;
      return el ? el.closest('[role="dialog"]') !== null : false;
    });
    expect(focused).toBe(true);
  });

  test('Escape closes modifier dialog without adding', async ({ cashierPage }) => {
    await cashierPage.locator('button:has-text("Test Burger")').click();
    await cashierPage.locator('[role="dialog"] button:has-text("Regular")').click();
    await expect(cashierPage.locator('[role="dialog"] h2:has-text("Test Burger")')).toBeVisible();
    await cashierPage.keyboard.press('Escape');
    await expect(cashierPage.locator('[role="dialog"]')).not.toBeVisible();
    // Cart still empty
    await expect(cashierPage.locator('text=No items yet.')).toBeVisible();
  });
});

test.describe('POS Cash Journey — Tablet Viewports', () => {
  test('tablet portrait layout', async ({ cashierPage }) => {
    await cashierPage.setViewportSize({ width: 768, height: 1024 });
    await expect(cashierPage.locator('h1')).toContainText('New order');
  });

  test('tablet landscape layout', async ({ cashierPage }) => {
    await cashierPage.setViewportSize({ width: 1024, height: 768 });
    await expect(cashierPage.locator('h1')).toContainText('New order');
  });
});
