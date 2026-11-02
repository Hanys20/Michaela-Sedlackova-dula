const SITE_URL = 'https://michaelasedlackova.info';
const FONT = 'Arial,Helvetica,sans-serif';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function paragraph(content, extra = '') {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.75;${extra}">${content}</p>`;
}

function heading(content) {
  return `<h2 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.3;font-weight:normal;color:#3a3038;">${content}</h2>`;
}

function section(content) {
  return `<tr><td class="email-padding" style="padding:28px 36px;border-top:1px solid #eee4e8;">${content}</td></tr>`;
}

function detail(label, value) {
  return `<tr><td valign="top" style="width:28%;padding:9px 12px 9px 0;border-bottom:1px solid #eadde3;font-size:13px;line-height:1.6;color:#645868;">${label}</td><td valign="top" style="padding:9px 0;border-bottom:1px solid #eadde3;font-size:15px;line-height:1.6;color:#3a3038;font-weight:bold;overflow-wrap:anywhere;">${value}</td></tr>`;
}

function emailLayout({ preheader, eyebrow, title, intro, content, footer }) {
  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)} | Michaela Sedláčková</title>
  <style>
    body { margin:0; padding:0; }
    table { border-collapse:collapse; }
    a { color:#87485b; }
    @media screen and (max-width:620px) {
      .email-outer { padding:12px 8px !important; }
      .email-padding { padding-left:22px !important; padding-right:22px !important; }
      .email-title { font-size:30px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f5f0f2;color:#3a3038;font-family:${FONT};-webkit-text-size-adjust:100%;">
  <div style="display:none;font-size:1px;color:#f5f0f2;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f5f0f2" style="width:100%;background-color:#f5f0f2;">
    <tr><td class="email-outer" align="center" style="padding:32px 16px;">
      <!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e9dfe4;">
        <tr><td style="height:5px;background-color:#9e5a6e;font-size:1px;line-height:5px;">&nbsp;</td></tr>
        <tr><td class="email-padding" style="padding:28px 36px 24px;">
          <a href="${SITE_URL}" style="font-family:Georgia,'Times New Roman',serif;font-size:23px;line-height:1.4;color:#87485b;text-decoration:none;">Michaela Sedláčková</a><br>
          <span style="font-size:12px;line-height:1.8;color:#645868;">porodní asistentka a dula</span>
        </td></tr>
        <tr><td class="email-padding" bgcolor="#f5ecef" style="padding:30px 36px;background-color:#f5ecef;">
          <p style="margin:0 0 12px;font-size:11px;line-height:1.5;letter-spacing:2px;font-weight:bold;color:#87485b;text-transform:uppercase;">${escapeHtml(eyebrow)}</p>
          <h1 class="email-title" style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:36px;line-height:1.18;font-weight:normal;color:#3a3038;">${escapeHtml(title)}</h1>
          ${intro}
        </td></tr>
        ${content}
        <tr><td class="email-padding" style="padding:24px 36px;background-color:#fbf8f9;border-top:1px solid #eee4e8;">${footer}</td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
      <p style="margin:20px 0 0;font-family:${FONT};font-size:12px;line-height:1.7;color:#645868;text-align:center;">Michaela Sedláčková · porodní asistentka a dula<br><a href="${SITE_URL}" style="color:#87485b;text-decoration:underline;">www.michaelasedlackova.info</a></p>
    </td></tr>
  </table>
</body>
</html>`;
}

export function bookingConfirmationHtml({ reg, slot, course, dateLabel, variableSymbol, qrImageUrl }) {
  const price = `${Number(reg.price).toLocaleString('cs-CZ')} Kč`;
  const summary = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;">
    ${detail('Kurz', escapeHtml(course.label))}
    ${detail('Termín', escapeHtml(dateLabel))}
    ${slot.time_label ? detail('Čas', escapeHtml(slot.time_label)) : ''}
    ${slot.address ? detail('Místo konání', escapeHtml(slot.address).replace(/\r?\n/g, '<br>')) : ''}
    ${detail('Účast', reg.attendance_type === 'pair' ? 'V páru' : 'Jednotlivec')}
    ${detail('Cena celkem', escapeHtml(price))}
  </table>`;
  const payment = qrImageUrl
    ? `${paragraph('Pro potvrzení rezervace prosím uhraďte kurz pomocí QR kódu níže.')}
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;"><tr><td align="center" bgcolor="#faf7f8" style="padding:22px 12px;background-color:#faf7f8;border:1px solid #eee4e8;">
         <p style="margin:0 0 16px;font-size:25px;line-height:1.3;font-weight:bold;color:#87485b;">${escapeHtml(price)}</p>
         <img src="${escapeHtml(qrImageUrl)}" alt="QR kód pro úhradu kurzu" width="220" height="220" style="display:block;width:220px;max-width:100%;height:auto;margin:0 auto;border:8px solid #ffffff;">
         <p style="margin:16px 0 0;font-size:13px;line-height:1.7;color:#645868;">Variabilní symbol<br><strong style="font-size:18px;color:#3a3038;letter-spacing:1px;">${escapeHtml(variableSymbol)}</strong></p>
       </td></tr></table>`
    : paragraph('Platební údaje vám pošleme samostatně.');

  return emailLayout({
    preheader: `${course.label} · ${dateLabel} · Praktické informace a platba za kurz.`,
    eyebrow: 'Vaše rezervace je přijata',
    title: 'Děkuji za vaši důvěru.',
    intro: `${paragraph('Dobrý den,')}${paragraph('jsem moc ráda, že jste si rezervovali místo na mém předporodním kurzu. Těším se, že vás provedu přípravou na porod, šestinedělím i prvními dny s miminkem a pomohu vám získat jistotu i klid před tímto výjimečným obdobím.', 'margin-bottom:0;')}`,
    content: [
      section(`${heading('Vaše rezervace')}${summary}`),
      section(`${heading('Platba za kurz')}${payment}${paragraph('Po přijetí platby je vaše rezervace závazně potvrzena.', 'margin-top:16px;margin-bottom:0;color:#645868;font-size:13px;')}`),
      section(`${heading('Co si vzít s sebou?')}${paragraph('Vezměte si prosím pohodlné oblečení a přezůvky nebo teplé ponožky.')}${paragraph('Vše potřebné bude na místě připravené.', 'margin-bottom:14px;')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="#f5ecef" style="padding:14px 18px;background-color:#f5ecef;border-left:3px solid #9e5a6e;font-size:15px;line-height:1.7;">Drobné občerstvení je zajištěno.</td></tr></table>`),
      section(`${heading('Jak se ke mně dostanete?')}${paragraph('Parkování v okolí je možné, o víkendu zde není zpoplatněno.')}${paragraph('Po příchodu prosím zazvoňte na zvonek <strong>„Krajinou duše“</strong>.')}${paragraph('Pokud byste nemohli zvonek najít nebo potřebovali pomoc, neváhejte mi zavolat na <a href="tel:+420775645743" style="color:#87485b;font-weight:bold;text-decoration:underline;white-space:nowrap;">+420&nbsp;775&nbsp;645&nbsp;743</a>.', 'margin-bottom:0;')}`),
      section(`${heading('Těším se na vás osobně.')}${paragraph('Přeji vám klidné dny plné těšení na vaše miminko. Pokud budete potřebovat cokoliv upřesnit nebo se na něco zeptat, budu ráda, když se mi ozvete.')}${paragraph('S přáním všeho dobrého,', 'margin-bottom:8px;')}<p style="margin:0;font-family:Georgia,\'Times New Roman\',serif;font-size:22px;line-height:1.4;color:#87485b;">Michaela Sedláčková</p><p style="margin:4px 0 0;font-size:13px;line-height:1.7;color:#645868;">porodní asistentka a dula</p>`),
    ].join(''),
    footer: paragraph('Máte otázky? Zavolejte mi na <a href="tel:+420775645743" style="color:#87485b;text-decoration:underline;white-space:nowrap;">+420&nbsp;775&nbsp;645&nbsp;743</a>.<br>Více informací najdete také na <a href="https://michaelasedlackova.info" style="color:#87485b;text-decoration:underline;">mém webu</a>.', 'font-size:13px;margin-bottom:0;color:#645868;'),
  });
}

export function adminNotificationHtml({ name, email, phone, billing_address, message, attendance_type, price, course, dateLabel, slot }) {
  return emailLayout({
    preheader: `${name} · ${course.label} · ${dateLabel}`,
    eyebrow: 'Přehled pro pořadatelku',
    title: 'Nová rezervace kurzu',
    intro: paragraph('Na kurz se právě přihlásil nový účastník. Přehled rezervace najdete níže.', 'margin-bottom:0;'),
    content: section(`${heading('Účastník a rezervace')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${detail('Jméno', escapeHtml(name))}
      ${detail('E-mail', `<a href="mailto:${escapeHtml(email)}" style="color:#87485b;text-decoration:underline;">${escapeHtml(email)}</a>`)}
      ${phone ? detail('Telefon', escapeHtml(phone)) : ''}
      ${billing_address ? detail('Fakturační adresa', escapeHtml(billing_address).replace(/\r?\n/g, '<br>')) : ''}
      ${detail('Kurz', escapeHtml(course.label))}
      ${detail('Termín', escapeHtml(dateLabel))}
      ${slot.time_label ? detail('Čas', escapeHtml(slot.time_label)) : ''}
      ${detail('Účast', attendance_type === 'pair' ? 'V páru' : 'Jednotlivec')}
      ${detail('Cena', `${Number(price).toLocaleString('cs-CZ')} Kč`)}
    </table>`)
      + (message ? section(`${heading('Zpráva od účastníka')}${paragraph(escapeHtml(message).replace(/\r?\n/g, '<br>'), 'margin-bottom:0;overflow-wrap:anywhere;')}`) : ''),
    footer: paragraph(`<a href="${SITE_URL}/admin/" style="color:#87485b;font-weight:bold;text-decoration:underline;">Otevřít správu rezervací</a>`, 'margin-bottom:0;'),
  });
}
