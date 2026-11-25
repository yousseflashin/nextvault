function normalizeDomain(service) {
  if (!service) return '';
  return String(service)
    .trim()
    .toLowerCase()
    .replace(/^(https?:\/\/)?(www\.)?/, '')
    .replace(/\/.*$/, '');
}

module.exports = {
  normalizeDomain
};
