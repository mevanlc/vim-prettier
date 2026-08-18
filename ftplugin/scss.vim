if &filetype =~# '\v<scss>'
  let b:prettier_ft_default_args = {
    \ 'parser': 'scss',
    \ }
endif
