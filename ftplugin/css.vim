if &filetype =~# '\v<css>'
  let b:prettier_ft_default_args = {
    \ 'parser': 'css',
    \ }
endif
