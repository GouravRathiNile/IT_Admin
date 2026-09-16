const test = require("node:test");
const assert = require("node:assert/strict");
const nodemailer = require("nodemailer");

const withMockTransport = async (work) => {
  const originalCreateTransport = nodemailer.createTransport;
  const originalEnvironment = {
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
  };
  const sent = [];

  process.env.SMTP_USER = "mailer@example.com";
  process.env.SMTP_PASSWORD = "test-password";
  nodemailer.createTransport = () => ({
    sendMail: async (mail) => {
      sent.push(mail);
      return { messageId: `test-${sent.length}` };
    },
  });

  const servicePath = require.resolve("../../utils/emailService");
  const capexTemplatePath = require.resolve("../../services/CapexService/CapexEmailTemplate");
  delete require.cache[servicePath];
  delete require.cache[capexTemplatePath];
  try {
    await work({ ...require(servicePath), ...require(capexTemplatePath) }, sent);
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    delete require.cache[servicePath];
    delete require.cache[capexTemplatePath];
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test("notification email uses the CAPEX notification content in the generic template", async () => {
  await withMockTransport(async ({ sendNotificationEmail }, sent) => {
    await sendNotificationEmail("hod@example.com", {
      title: "CAPEX - Printer - Finance - HJU",
      message: "Replacement printer",
      module_name: "Capex",
      action: "CREATED",
      organization_name: "Howard Johnson Udaipur",
      logo_url: "https://assets.example.com/hju.png",
      email_data: {
        kind: "CREATE", item: "Printer", department: "Finance", quantity: 2,
        rate: 19500, total: 39000, description: "Replacement printer",
      },
    });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "hod@example.com");
    assert.equal(sent[0].subject, "[HotelOps] CAPEX - Printer - Finance - HJU");
    assert.match(sent[0].html, />CAPEX - Printer<\/div>/);
    assert.doesNotMatch(sent[0].html, />CAPEX - Printer - Finance - HJU<\/div>/);
    assert.match(sent[0].html, /Dear Sir\/Madam,/);
    assert.match(sent[0].html, /A new CAPEX request has been created and is available for your review\./);
    assert.match(sent[0].html, /https:\/\/assets\.example\.com\/hju\.png/);
    assert.match(sent[0].html, /Howard Johnson Udaipur/);
    assert.match(sent[0].html, /CAPEX Details/);
    assert.match(sent[0].html, /₹ 19,500/);
    assert.match(sent[0].html, /₹ 39,000/);
    assert.doesNotMatch(sent[0].html, /Action Details/);
    assert.doesNotMatch(sent[0].html, />Module</);
    assert.doesNotMatch(sent[0].html, />Status</);
    assert.match(sent[0].html, /<a href="http:\/\/localhost:5173\/Hotelops\/Pages\/Capex\/Pages"[^>]*>VIEW CAPEX REQUEST<\/a>/);
    assert.equal((sent[0].html.match(/Replacement printer/g) || []).length, 1);
    assert.match(sent[0].text, /automated notification from HotelOps/);
  });
});

test("CAPEX action email contains action details and configurable request link", async () => {
  const originalUrl = process.env.CAPEX_FRONTEND_URL;
  process.env.CAPEX_FRONTEND_URL = "https://hotelops.example.com/capex";
  try {
    await withMockTransport(async ({ sendNotificationEmail }, sent) => {
      await sendNotificationEmail("creator@example.com", {
        title: "CAPEX - Printer - Finance - HJU",
        message: "Approved by GM",
        organization_name: "Howard Johnson Udaipur",
        email_data: {
          kind: "APPROVE", item: "Printer", department: "Finance", quantity: 2,
          rate: 19500, total: 39000, description: "Replacement printer",
          actionQuantity: 2, remark: "Approved", actionBy: "General Manager",
          actionDate: "2026-09-15T06:30:00.000Z",
        },
      });

      assert.match(sent[0].html, /Action Details/);
      assert.match(sent[0].html, /<tr><td style="padding:0 28px 22px;">\s*<div[^>]*>Action Details<\/div>\s*<table role="presentation" width="100%"/);
      assert.doesNotMatch(sent[0].html, /<\/tr>\s*<div[^>]*>\s*<div[^>]*>Action Details/);
      assert.match(sent[0].html, />CAPEX - Printer<\/div>/);
      assert.match(sent[0].html, /Dear Sir\/Madam,/);
      assert.match(sent[0].html, /The CAPEX request has been approved by General Manager\./);
      assert.match(sent[0].html, /Action Quantity/);
      assert.match(sent[0].html, /Approved/);
      assert.match(sent[0].html, /General Manager/);
      assert.match(sent[0].html, /word-break:break-word;overflow-wrap:anywhere/);
      assert.match(sent[0].html, /<a href="https:\/\/hotelops\.example\.com\/capex"/);
    });
  } finally {
    if (originalUrl === undefined) delete process.env.CAPEX_FRONTEND_URL;
    else process.env.CAPEX_FRONTEND_URL = originalUrl;
  }
});

test("CAPEX action emails show the finalized action-specific introduction", async () => {
  await withMockTransport(async ({ sendNotificationEmail }, sent) => {
    const expected = {
      REJECT: "The CAPEX request has been rejected by CEO.",
      RETURN: "The CAPEX request has been returned by CEO for further review.",
      HOLD: "The CAPEX request has been placed on hold by CEO.",
    };
    for (const [kind, introduction] of Object.entries(expected)) {
      await sendNotificationEmail("creator@example.com", {
        title: "Original notification title",
        organization_name: "HJU",
        email_data: {
          kind, item: "Printer", department: "Finance", description: "Only once",
          actionBy: "CEO", actionQuantity: 1, remark: "Reviewed",
          actionDate: "2026-09-15T06:30:00.000Z",
        },
      });
      assert.match(sent.at(-1).html, new RegExp(introduction.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.equal((sent.at(-1).html.match(/Only once/g) || []).length, 1);
    }
  });
});

test("password-reset OTP email keeps its existing subject and content", async () => {
  await withMockTransport(async ({ sendPasswordResetOTP }, sent) => {
    await sendPasswordResetOTP("user@example.com", "123456");

    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "user@example.com");
    assert.equal(sent[0].subject, "Password Reset Verification OTP");
    assert.match(sent[0].text, /Your verification OTP is: 123456/);
    assert.match(sent[0].html, /123456/);
  });
});
