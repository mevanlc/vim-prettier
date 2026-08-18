let s:ROOT_DIR = fnamemodify(resolve(expand('<sfile>:p')), ':h:h')
let s:plugin_path = s:ROOT_DIR . '/node_modules/@prettier/plugin-php/src/index.mjs'

if &filetype =~# '\v<php>'
  let b:prettier_ft_default_args = {
    \ 'parser': 'php',
    \ }

  if filereadable(s:plugin_path)
    let b:prettier_ft_default_args['bundledPlugins'] = [s:plugin_path]
  endif
endif
