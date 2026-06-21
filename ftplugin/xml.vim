" markdown/php files run this as well
" https://stackoverflow.com/questions/22839269/why-does-vim-default-markdown-ftplugin-source-html-ftplugins-is-there-any-ways
if expand('%:e') ==# 'xml'
  let s:ROOT_DIR = fnamemodify(resolve(expand('<sfile>:p')), ':h:h')
  let s:plugin_path = s:ROOT_DIR . '/node_modules/@prettier/plugin-xml/src/plugin.js'

  let b:prettier_ft_default_args = {
    \ 'parser': 'xml',
    \ }

  if filereadable(s:plugin_path)
    let b:prettier_ft_default_args['bundledPlugins'] = [s:plugin_path]
  endif
endif
