const AdminNotification = require("../models/AdminNotification");

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function listMine(req, res) {
  const { page = 1, limit = 20, type, read, search } = req.query;

  const and = [{ company: req.user.company }];
  if (type) and.push({ type });
  if (read === "true") and.push({ read: true });
  if (read === "false") and.push({ read: false });
  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    and.push({ $or: [{ title: pattern }, { message: pattern }] });
  }
  const filter = { $and: and };

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(100, Math.max(1, Number(limit)));

  const [notifications, total] = await Promise.all([
    AdminNotification.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    AdminNotification.countDocuments(filter),
  ]);

  res.json({ notifications, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) || 1 });
}

async function unreadCount(req, res) {
  const count = await AdminNotification.countDocuments({ company: req.user.company, read: false });
  res.json({ count });
}

async function markRead(req, res) {
  const notification = await AdminNotification.findOneAndUpdate(
    { _id: req.params.id, company: req.user.company },
    { read: true },
    { new: true }
  );
  if (!notification) return res.status(404).json({ error: "Notification not found" });
  res.json(notification);
}

async function markAllRead(req, res) {
  await AdminNotification.updateMany({ company: req.user.company, read: false }, { read: true });
  res.json({ message: "All notifications marked as read" });
}

async function remove(req, res) {
  const notification = await AdminNotification.findOneAndDelete({ _id: req.params.id, company: req.user.company });
  if (!notification) return res.status(404).json({ error: "Notification not found" });
  res.json({ message: "Notification deleted" });
}

module.exports = { listMine, unreadCount, markRead, markAllRead, remove };
