# toy inventory debit — intentional race for agent detection eval
STOCK = {"sku": 5}

def debit(sku, n):
    # check-then-act without lock / atomic update
    left = STOCK.get(sku, 0)
    if left >= n:
        STOCK[sku] = left - n
        return True
    return False
