'use strict';
// Correctness checks for the legacy global browser scripts, Node tools and GAS.
module.exports=[{
  files:['**/*.js','**/*.cjs','*.gs'],
  ignores:['node_modules/**','_preview/**','_deploy/**','_work/**'],
  languageOptions:{ecmaVersion:2022,sourceType:'script'},
  rules:{'no-unreachable':'error','no-dupe-args':'error','no-dupe-keys':'error','no-duplicate-case':'error','no-invalid-regexp':'error','no-unsafe-finally':'error','valid-typeof':'error','no-unexpected-multiline':'error','constructor-super':'error','no-class-assign':'error','no-const-assign':'error','no-unsafe-negation':'error','use-isnan':'error'}
}];
