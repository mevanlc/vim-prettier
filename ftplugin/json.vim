if &filetype =~# '\v<json>'
  let b:prettier_ft_default_args = {
    \ 'parser': 'json',
    \ }
endif
