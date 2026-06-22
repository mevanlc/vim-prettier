if &filetype =~# '\v<less>'
  let b:prettier_ft_default_args = {
    \ 'parser': 'less',
    \ }
endif
