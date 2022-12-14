# Simple Safemoon ERC20 

這是一個 erc20 的專案
- 每次 Transfer 會徵收 5% 的稅，『即時』依照餘額比例分給所有持幣者
- 每次 Transfer 會徵收 5% 的稅，依照鎖倉代幣的時間和數量，分給鎖倉代幣用戶
- 每次在 Uniswap 上賣出會徵收 5% 的稅，會用來向 Uniswap 上的池子添加流動性
- 參考 SafeMoon 代幣：https://github.com/safemoonprotocol/Safemoon.sol

## 實作細節
`_tTotal` 代表的是實際的 token 總量，就是 total supply  
`_rTotal` 代表的是「股份總量」，`(MAX - (MAX % _tTotal))` 扣掉餘數，每 1 股可以兌換到整數數量的 token  
`_rOwned` 紀錄各 address 擁有股份數量  
`_isExcludedFromFee` 紀錄不用被徵收 fee 的 address，可以實現 owner 轉 token 不用被收稅  
`_accountStakeReward` 當前的鎖倉獎勵  
`_accountStakeInfos` 當前的鎖倉資訊  

1. 即時是怎麼做到的？  
  關鍵在 `_transfer` 裡的 `_rTotal = _rTotal.sub(rFee);`  
  實際上代表的是把股份銷毀  
  因為每個人的餘額是透過 股份 -> 實際 token  
  `_rTotal` 減少代表總股份數減少，代表分母減少  
  每個人擁有的股份可以對應到的 token 就增加了  
  所以持有 token 的人，股份數不變，但是餘額增加  

2. 怎麼知道該 token 在 uniswap 上賣出？  
可以透過判斷 transfer 的 to 是不是 uniswap pair 的地址  
在 uniswap 上 swap token 時，將要賣出的 token 轉給 pair，收到要轉換的 token  

3. guideline: https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/GUIDELINES.md
## 新增 .env
```
ALCHEMY_KEY=your_alchemy_key
```

## run script
```
npm install
npx hardhat test ./test/simple-safemoon.ts
```
