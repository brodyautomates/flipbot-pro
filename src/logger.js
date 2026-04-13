'use strict';
const chalk = require('chalk');

const ts = () => new Date().toLocaleTimeString('en-US', { hour12: false });

module.exports = {
  info:    (...a) => console.log(chalk.gray(`[${ts()}]`), chalk.cyan('INFO '), ...a),
  success: (...a) => console.log(chalk.gray(`[${ts()}]`), chalk.green('OK   '), ...a),
  warn:    (...a) => console.log(chalk.gray(`[${ts()}]`), chalk.yellow('WARN '), ...a),
  error:   (...a) => console.log(chalk.gray(`[${ts()}]`), chalk.red('ERR  '), ...a),
  scan:    (...a) => console.log(chalk.gray(`[${ts()}]`), chalk.blue('SCAN '), ...a),
  match:   (...a) => console.log(chalk.gray(`[${ts()}]`), chalk.greenBright('MATCH'), ...a),
  lb:      (...a) => console.log(chalk.gray(`[${ts()}]`), chalk.yellow('LB   '), ...a),
};
