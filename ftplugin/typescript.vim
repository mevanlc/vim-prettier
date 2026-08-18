if &filetype =~# '\v<typescript>'
  let b:prettier_ft_default_args = {
    \ 'parser': 'typescript',
    \ }
endif
