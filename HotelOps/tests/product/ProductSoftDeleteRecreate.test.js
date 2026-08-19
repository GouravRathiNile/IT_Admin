const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pool } = require("../../db");
const ProductService = require("../../services/ITAdminService/ProductService");

const originalQuery = pool.query;

const product = (overrides = {}) => ({
  ProductName: "Operations Portal",
  ProductLabel: "OPS",
  ProductCategoryID: 1,
  DevelopmentLanguage: "Node.js",
  IsActive: true,
  IsDeleted: false,
  CreatedBy: 10,
  ...overrides,
});

const duplicateError = (field, value) => Object.assign(
  new Error(`duplicate key value violates unique constraint for ${field}`),
  {
    code: "23505",
    constraint: `product_master_active_${field.toLowerCase()}_uidx`,
    detail: `Key (${field})=(${value}) already exists.`,
  }
);

function installProductStore() {
  const rows = [];
  let nextID = 1;

  pool.query = async (sql, values) => {
    if (/INSERT INTO Product_Master/i.test(sql)) {
      // Yield once so concurrent calls both exercise the same uniqueness gate.
      await Promise.resolve();
      const [name, label, categoryID, language, isActive, isDeleted, createdBy] = values;
      if (rows.some((row) => !row.IsDeleted && row.ProductName === name)) {
        throw duplicateError("ProductName", name);
      }
      if (rows.some((row) => !row.IsDeleted && row.ProductLabel === label)) {
        throw duplicateError("ProductLabel", label);
      }
      const row = {
        ProductID: nextID++, ProductName: name, ProductLabel: label,
        ProductCategoryID: categoryID, DevelopmentLanguage: language,
        IsActive: isActive, IsDeleted: isDeleted, CreatedBy: createdBy,
        DeletedBy: null, DeletedDate: null,
      };
      rows.push(row);
      return { rows: [row] };
    }

    if (/UPDATE Product_Master[\s\S]*IsDeleted = TRUE/i.test(sql)) {
      const [deletedBy, productID] = values;
      const row = rows.find((candidate) => candidate.ProductID === productID && !candidate.IsDeleted);
      if (!row) return { rows: [] };
      row.IsDeleted = true;
      row.DeletedBy = deletedBy;
      row.DeletedDate = new Date("2026-08-14T00:00:00Z");
      return { rows: [row] };
    }

    throw new Error("Unexpected SQL in product test");
  };

  return rows;
}

test.afterEach(() => {
  pool.query = originalQuery;
});

test("soft-deleted product details create a new product identity", async () => {
  const rows = installProductStore();
  assert.equal((await ProductService.createProduct(product())).success, true);
  assert.equal((await ProductService.deleteProduct({ ProductID: 1, DeletedBy: 20 })).success, true);

  const deletedSnapshot = { ...rows[0] };
  assert.equal((await ProductService.createProduct(product())).success, true);

  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].ProductID, rows[1].ProductID);
  assert.deepEqual(rows[0], deletedSnapshot);
  assert.equal(rows[0].IsDeleted, true);
  assert.equal(rows[1].IsDeleted, false);
});

test("active product name remains unique", async () => {
  installProductStore();
  await ProductService.createProduct(product());
  const result = await ProductService.createProduct(product({ ProductLabel: "OTHER" }));
  assert.equal(result.success, false);
  assert.equal(result.errorCode, "DUPLICATE_PRODUCT");
  assert.equal(result.field, "ProductName");
});

test("active product label remains unique", async () => {
  installProductStore();
  await ProductService.createProduct(product());
  const result = await ProductService.createProduct(product({ ProductName: "Other Product" }));
  assert.equal(result.success, false);
  assert.equal(result.errorCode, "DUPLICATE_PRODUCT");
  assert.equal(result.field, "ProductLabel");
});

test("a deleted name or label can be reused independently", async () => {
  const rows = installProductStore();
  await ProductService.createProduct(product());
  await ProductService.deleteProduct({ ProductID: 1, DeletedBy: 20 });

  assert.equal((await ProductService.createProduct(product({ ProductLabel: "NEW" }))).success, true);
  rows[1].IsDeleted = true;
  assert.equal((await ProductService.createProduct(product({ ProductName: "New Product" }))).success, true);
});

test("concurrent creates allow only one active product with the same details", async () => {
  const rows = installProductStore();
  const results = await Promise.all([
    ProductService.createProduct(product()),
    ProductService.createProduct(product()),
  ]);

  assert.equal(results.filter((result) => result.success).length, 1);
  assert.equal(results.filter((result) => result.errorCode === "DUPLICATE_PRODUCT").length, 1);
  assert.equal(rows.filter((row) => !row.IsDeleted).length, 1);
});

test("migration replaces global uniqueness with active-row partial indexes", () => {
  const migration = fs.readFileSync(
    path.join(__dirname, "../../docs/product-active-uniqueness-migration.sql"),
    "utf8"
  );

  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /duplicate active ProductName values exist/);
  assert.match(migration, /duplicate active ProductLabel values exist/);
  assert.match(migration, /CREATE UNIQUE INDEX product_master_active_productname_uidx[\s\S]*WHERE IsDeleted = FALSE;/i);
  assert.match(migration, /CREATE UNIQUE INDEX product_master_active_productlabel_uidx[\s\S]*WHERE IsDeleted = FALSE;/i);
  assert.match(migration, /COMMIT;/);
});
