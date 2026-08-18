if &filetype =~# '\v<markdown>'
  let b:prettier_ft_default_args = {
    \ 'parser': 'markdown',
    \ }
endif
