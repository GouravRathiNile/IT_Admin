const moment = require("moment");

const formatDate = (date, format = "DD MMM YYYY") => {
  if (!date) return null;
  return moment(date).format(format);
};

module.exports = {
  formatDate,
};