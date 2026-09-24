const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname,
  '../../services/EngineeringService/EngineeringService.js'), 'utf8');
const start = source.indexOf('const processAMCApproval = async (data) => {');
const end = source.indexOf('// ============================================================Create AMC Approval Config', start);

async function run({ action = 'APPROVE', final = true, rowCount = 1,
  updateError = false, alreadyApproved = false } = {}) {
  const calls = [];
  let released = false;
  const client = {
    release() { released = true; },
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM Engineering_AMC_Master am') && sql.includes('SELECT')) {
        return { rows: [{ amcid: 13, equipmentid: 17, organizationid: 20,
          createdby: 4, equipmentname: 'HVAC' }] };
      }
      if (sql.includes('FROM Engineering_AMC_Approval')) {
        return { rows: [{ fcstatus: 'Pending', finalstatus: alreadyApproved ? 'Approved' : 'Pending' }] };
      }
      if (sql.includes('UPDATE Engineering_Equipment_Entry_Master')) {
        if (updateError) throw new Error('equipment update failed');
        return { rowCount, rows: [] };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const context = {
    pool: { connect: async () => client },
    resolveAMCAccess: async () => ({ approvalRole: 'FC' }),
    getAMCApprovalFlow: async () => (final ? ['FC'] : ['FC', 'GM']).map(ApprovalRole => ({ ApprovalRole })),
    notifyCommittedAMCApproval: () => calls.push({ sql: 'NOTIFY' }),
    fail: (message, statusCode) => ({ success: false, message, statusCode }),
    ok: message => ({ success: true, message }),
    retryableDatabaseResponse: () => null,
    databaseFailure: (error, operation) => {
      assert.ok(error instanceof Error);
      assert.equal(operation, 'Process AMC approval');
      return { success: false, statusCode: 500 };
    },
    console: { error() {} },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + '\nthis.approve = processAMCApproval;', context);
  const result = await context.approve({ AMCID: 13, UserID: 7, Action: action, Remarks: 'Reviewed' });
  assert.equal(released, true);
  return { result, calls };
}

test('configured final approver syncs equipment before commit and notification', async () => {
  const { result, calls } = await run();
  assert.equal(result.success, true);
  const index = calls.findIndex(c => c.sql.includes('UPDATE Engineering_Equipment_Entry_Master'));
  const update = calls[index];
  assert.ok(index > calls.findIndex(c => c.sql.includes('UPDATE Engineering_AMC_Approval')));
  assert.ok(index < calls.findIndex(c => c.sql === 'COMMIT'));
  assert.ok(calls.findIndex(c => c.sql === 'COMMIT') < calls.findIndex(c => c.sql === 'NOTIFY'));
  assert.deepEqual(Array.from(update.params), [13, 7]);
  for (const mapping of ['AMCType = am.AMCType', 'AMCStartDate = am.AMCStartDate',
    'AMCEndDate = am.AMCEndDate', 'AMCYearlyExpense = am.AMCAmount',
    'e.EquipmentID = am.EquipmentID', 'e.OrganizationID = am.OrganizationID', 'e.IsDeleted = FALSE']) {
    assert.ok(update.sql.includes(mapping), mapping);
  }
  assert.match(update.sql, /WHEN am.AMCEndDate < CURRENT_DATE THEN 'Expired AMC'\s+ELSE 'Under AMC'/);
});

test('intermediate approval, rejection, return and repeated approval do not sync equipment', async () => {
  for (const options of [{ final: false }, { action: 'REJECT' }, { action: 'RETURN' }, { alreadyApproved: true }]) {
    const { calls } = await run(options);
    assert.ok(!calls.some(c => c.sql.includes('UPDATE Engineering_Equipment_Entry_Master')));
  }
});

test('missing equipment or SQL failure rolls back approval without notifying', async () => {
  for (const options of [{ rowCount: 0 }, { updateError: true }]) {
    const { result, calls } = await run(options);
    assert.equal(result.success, false);
    assert.ok(calls.some(c => c.sql === 'ROLLBACK'));
    assert.ok(!calls.some(c => ['COMMIT', 'NOTIFY'].includes(c.sql)));
  }
});
