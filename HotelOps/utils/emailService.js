const nodemailer = require("nodemailer");

const getTransporter = () => {
  const host = process.env.SMTP_HOST || "host56.registrar-servers.com";
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (!user || !pass) {
    throw new Error("SMTP configuration is missing");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
};

const sendEmail = async (
  to,
  subject,
  text,
  html,
  attachments = [],
  cc = ""
) => {
  try {
    const fromName = process.env.SMTP_FROM_NAME || "HotelOps";
    const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;

    const info = await getTransporter().sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      cc: cc || undefined,
      subject,
      text,
      html,
      attachments,
    });

    console.log("Email sent: %s", info.messageId);
    return info;
  } catch (error) {
    console.error("Email send failed:", error.message);
    throw error;
  }
};

const sendPasswordResetOTP = async (email, otp) => {
  const subject = "Password Reset Verification OTP";
  const text = [
      "We received a request to reset your password.",
      `Your verification OTP is: ${otp}`,
      "This OTP is valid for 10 minutes.",
      "If you did not request a password reset, please ignore this email.",
    ].join("\n\n");
  const html = `
    <p>We received a request to reset your password.</p>
    <p>Your verification OTP is:</p>
    <p style="font-size:24px;font-weight:bold;letter-spacing:4px;">${otp}</p>
    <p>This OTP is valid for <strong>10 minutes</strong>.</p>
    <p>If you did not request a password reset, please ignore this email.</p>
  `;

  return sendEmail(email, subject, text, html);
};

module.exports = {
  sendEmail,
  sendPasswordResetOTP,
};
