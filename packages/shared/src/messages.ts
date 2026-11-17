// Text the server sends people outside the app: emails and push messages
// (ADR-066). Each person gets their chosen language, stored in users.locale.

export type MessageLocale = 'en' | 'ar';

export const LOCALE_COOKIE = 'atlas_locale';

export function messageLocale(value: unknown): MessageLocale {
  return value === 'ar' ? 'ar' : 'en';
}

/** The language chosen in the web app, from the request's Cookie header. */
export function localeFromCookies(
  header: string | undefined,
): MessageLocale | undefined {
  const match = new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=(en|ar)(?:;|$)`).exec(
    header ?? '',
  );
  return match?.[1] === 'ar' ? 'ar' : match?.[1] === 'en' ? 'en' : undefined;
}

const TEXT = {
  someone: { en: 'Someone', ar: 'شخص ما' },
  'verify.subject': {
    en: 'Verify your Atlas email address',
    ar: 'تأكيد بريدك الإلكتروني في أطلس',
  },
  'verify.text': {
    en: 'Confirm your email address to finish creating your Atlas account:\n\n{link}\n\nThis link expires in 24 hours.',
    ar: 'أكّد بريدك الإلكتروني لإكمال إنشاء حسابك في أطلس:\n\n{link}\n\nتنتهي صلاحية هذا الرابط خلال 24 ساعة.',
  },
  'reset.subject': {
    en: 'Reset your Atlas password',
    ar: 'إعادة تعيين كلمة مرورك في أطلس',
  },
  'reset.text': {
    en: 'Someone asked to reset the password for your Atlas account. If it was you, choose a new password here:\n\n{link}\n\nThis link expires in 1 hour. If you did not ask, you can ignore this email; your password has not changed.',
    ar: 'طلب أحدهم إعادة تعيين كلمة مرور حسابك في أطلس. إن كنت أنت، فاختر كلمة مرور جديدة من هنا:\n\n{link}\n\nتنتهي صلاحية هذا الرابط خلال ساعة واحدة. إن لم تطلب ذلك فتجاهل هذه الرسالة؛ كلمة مرورك لم تتغير.',
  },
  'welcome.subject': {
    en: 'You have been added to {organization} on Atlas',
    ar: 'تمت إضافتك إلى {organization} في أطلس',
  },
  'welcome.text': {
    en: 'Your organization added you to {organization} on Atlas. Choose a password to sign in:\n\n{link}\n\nThis link expires in 7 days. Afterwards, use "Forgot password" on the sign-in page.',
    ar: 'أضافتك مؤسستك إلى {organization} في أطلس. اختر كلمة مرور لتسجيل الدخول:\n\n{link}\n\nتنتهي صلاحية هذا الرابط خلال 7 أيام. بعد ذلك استخدم «نسيت كلمة المرور» في صفحة تسجيل الدخول.',
  },
  'invite.subject': {
    en: "You're invited to join {organization} on Atlas",
    ar: 'دعوة للانضمام إلى {organization} في أطلس',
  },
  'invite.text': {
    en: '{inviter} invited you to join the "{organization}" organization on Atlas as {role}.\n\nSign in with this email address, then accept here:\n\n{link}\n\nThis invitation expires in 7 days.',
    ar: 'دعاك {inviter} للانضمام إلى مؤسسة «{organization}» في أطلس بدور {role}.\n\nسجّل الدخول بهذا البريد الإلكتروني، ثم اقبل الدعوة من هنا:\n\n{link}\n\nتنتهي صلاحية هذه الدعوة خلال 7 أيام.',
  },
  'role.owner': { en: 'owner', ar: 'مالك' },
  'role.admin': { en: 'admin', ar: 'مسؤول' },
  'role.member': { en: 'member', ar: 'عضو' },
  'role.guest': { en: 'guest', ar: 'ضيف' },
  'assigned.subject': {
    en: '{key} was assigned to you: {title}',
    ar: 'أُسندت إليك المهمة {key}: {title}',
  },
  'assigned.opening': {
    en: '{who} assigned {key} to you.',
    ar: 'أسند {who} المهمة {key} إليك.',
  },
  'assigned.push': {
    en: '{who} assigned {key} to you',
    ar: 'أسند {who} المهمة {key} إليك',
  },
  'assigned.line': {
    en: '{who} assigned it to you',
    ar: 'أسندها {who} إليك',
  },
  'mention.subject': {
    en: '{who} mentioned you on {key}: {title}',
    ar: 'أشار إليك {who} في {key}: {title}',
  },
  'mention.opening': {
    en: '{who} mentioned you in a comment on {key}.',
    ar: 'أشار إليك {who} في تعليق على {key}.',
  },
  'mention.push': {
    en: '{who} mentioned you on {key}',
    ar: 'أشار إليك {who} في {key}',
  },
  'mention.line': { en: '{who} mentioned you', ar: 'أشار إليك {who}' },
  'comment.subject': {
    en: 'New comment on {key}: {title}',
    ar: 'تعليق جديد على {key}: {title}',
  },
  'comment.opening': {
    en: '{who} commented on {key}.',
    ar: 'علّق {who} على {key}.',
  },
  'comment.push': {
    en: '{who} commented on {key}',
    ar: 'علّق {who} على {key}',
  },
  'comment.line': { en: '{who} commented', ar: 'علّق {who}' },
  'notification.text': {
    en: 'Hello {name},\n\n{opening}\n\nOpen the task: {link}\n\nYou can turn these emails off on your notifications page in Atlas.\n',
    ar: 'مرحبًا {name}،\n\n{opening}\n\nافتح المهمة: {link}\n\nيمكنك إيقاف هذه الرسائل من صفحة الإشعارات في أطلس.\n',
  },
  'digest.subject.one': {
    en: 'Your Atlas summary: 1 unread notification',
    ar: 'ملخصك في أطلس: إشعار واحد غير مقروء',
  },
  'digest.subject.many': {
    en: 'Your Atlas summary: {count} unread notifications',
    ar: 'ملخصك في أطلس: {count} من الإشعارات غير المقروءة',
  },
  'digest.text': {
    en: 'Hello {name},\n\nSince your last summary:\n\n{lines}\n\nOpen your notifications: {link}\n\nYou chose a daily summary; change it on your notifications page in Atlas.\n',
    ar: 'مرحبًا {name}،\n\nمنذ ملخصك الأخير:\n\n{lines}\n\nافتح إشعاراتك: {link}\n\nاخترت ملخصًا يوميًا؛ يمكنك تغيير ذلك من صفحة الإشعارات في أطلس.\n',
  },
} satisfies Record<string, Record<MessageLocale, string>>;

export type MessageKey = keyof typeof TEXT;

/** The message in that language, with {name} placeholders filled. */
export function message(
  locale: MessageLocale,
  key: MessageKey,
  vars: Record<string, string | number> = {},
): string {
  return TEXT[key][locale].replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** Every key and its two texts, for tests. */
export const MESSAGE_TEXT: Readonly<
  Record<string, Readonly<Record<MessageLocale, string>>>
> = TEXT;
