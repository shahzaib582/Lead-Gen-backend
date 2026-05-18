function wrapEmail(title, rowsHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border-radius:8px;padding:40px;
                      box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          ${rowsHtml}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function otpCodeRow(otp, { background, border, color }) {
  return `
          <tr>
            <td align="center" style="padding:20px 0;">
              <div style="display:inline-block;background:${background};border:1px solid ${border};
                          border-radius:8px;padding:16px 40px;">
                <span style="font-size:36px;font-weight:bold;letter-spacing:12px;color:${color};">
                  ${otp}
                </span>
              </div>
            </td>
          </tr>`;
}

function buildVerificationEmail(otp, expiryMinutes) {
  const html = wrapEmail(
    'Email Verification',
    `
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <h2 style="margin:0;color:#1a1a1a;font-size:22px;">Verify Your Email</h2>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom:16px;color:#555;font-size:15px;line-height:1.6;">
              Use the code below to verify your email address.
              This code expires in <strong>${expiryMinutes} minutes</strong>.
            </td>
          </tr>
          ${otpCodeRow(otp, { background: '#f0f4ff', border: '#c7d4f7', color: '#3b5bdb' })}
          <tr>
            <td align="center" style="padding-top:16px;color:#888;font-size:13px;">
              If you did not request this, please ignore this email.
            </td>
          </tr>
    `
  );

  return {
    subject: 'Your verification code',
    html,
    text: `Your verification code is: ${otp}\nIt expires in ${expiryMinutes} minutes.`,
  };
}

function buildPasswordResetEmail(otp, expiryMinutes) {
  const html = wrapEmail(
    'Reset password',
    `
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <h2 style="margin:0;color:#1a1a1a;font-size:22px;">Reset your password</h2>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom:16px;color:#555;font-size:15px;line-height:1.6;">
              Use this code to set a new password. Expires in <strong>${expiryMinutes} minutes</strong>.
            </td>
          </tr>
          ${otpCodeRow(otp, { background: '#fff8f0', border: '#f0d9c7', color: '#d9480f' })}
          <tr>
            <td align="center" style="padding-top:16px;color:#888;font-size:13px;">
              If you did not request this, ignore this email.
            </td>
          </tr>
    `
  );

  return {
    subject: 'Your password reset code',
    html,
    text: `Your password reset code is: ${otp}\nExpires in ${expiryMinutes} minutes.`,
  };
}

module.exports = {
  buildVerificationEmail,
  buildPasswordResetEmail,
};
