const userService = require('../services/userService');
const AppError = require('../utils/AppError');
const googleAuthService = require('../services/googleAuthService');
const { accountHasCalendarScope } = require('../services/googleCalendarService');
const { toPublicUser } = require('../utils/userPublic');
const { successResponse } = require('../utils/response');

async function getCurrentUser(req, res, next) {
  try {
    const row = await userService.findUserById(req.user.id);
    const account = await googleAuthService.findGoogleAccountByUserId(req.user.id);

    const google = account
      ? {
          linked: true,
          email: account.email,
          calendarLinked: accountHasCalendarScope(account.scopes),
        }
      : { linked: false, calendarLinked: false };

    return successResponse(res, 200, 'User fetched successfully.', {
      user: {
        ...toPublicUser(row),
        googleAccessToken: req.user.googleAccessToken ?? null,
      },
      google,
    });
  } catch (err) {
    next(err);
  }
}

async function patchCurrentUser(req, res, next) {
  try {
    const {
      name,
      profile_pic,
      profilePic,
      address,
      contact,
      timezone,
      notificationsEnabled,
      notifications_enabled,
      password,
      oldPassword,
      old_password,
    } = req.body;

    let updated = null;

    if (password !== undefined && password !== null && String(password).trim() !== '') {
      const old = oldPassword ?? old_password;
      updated = await userService.changePassword(req.user.id, old, password);
    }

    const fields = {};
    if (name !== undefined) fields.name = name;
    if (profile_pic !== undefined) fields.profile_pic = profile_pic;
    if (profilePic !== undefined) fields.profile_pic = profilePic;
    if (address !== undefined) fields.address = address;
    if (contact !== undefined) fields.contact = contact;
    if (timezone !== undefined) fields.timezone = timezone;
    if (notificationsEnabled !== undefined) fields.notifications_enabled = notificationsEnabled;
    if (notifications_enabled !== undefined) fields.notifications_enabled = notifications_enabled;

    const hasProfileFields = Object.keys(fields).length > 0;
    if (hasProfileFields) {
      updated = await userService.updateUserProfile(req.user.id, fields);
    }

    if (!updated) {
      const row = await userService.findUserById(req.user.id);
      if (!row) throw new AppError('User not found.', 404);
      updated = row;
    }

    return successResponse(res, 200, 'Profile updated successfully.', {
      user: toPublicUser(updated),
    });
  } catch (err) {
    next(err);
  }
}

async function deleteAccount(req, res, next) {
  try {
    await userService.softDeleteUser(req.user.id);
    return successResponse(res, 200, 'Account deleted successfully.');
  } catch (err) {
    next(err);
  }
}

module.exports = { getCurrentUser, patchCurrentUser, deleteAccount };
