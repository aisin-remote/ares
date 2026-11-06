Imports SAP.Middleware.Connector
Imports System.Data
Imports System.Data.SqlClient
Imports System.Globalization

Public Class Form1
    Private _ccc As RfcDestination

    Dim log As String
    Dim con As New SqlConnection
    Dim con1 As New SqlConnection
    Dim con2 As New SqlConnection
    Dim con3 As New SqlConnection
    Dim con4 As New SqlConnection
    Dim cmd As New SqlCommand
    Dim cnt As New SqlCommand
    Dim cmdPO As New SqlCommand
    Dim cmdQty As New SqlCommand
    Dim cmdLine As New SqlCommand
    Dim reader As SqlDataReader
    Dim readerPO As SqlDataReader
    Dim readerLine As SqlDataReader
    Dim readerQty As SqlDataReader
    Dim itab As New SqlDataAdapter
    Dim iset As New DataSet
    Dim idt As New DataTable
    Dim numrows As Integer

    Dim sqlquery As String
    Dim count As String

    Dim PSTNG_DATE As String = "yyyyMMdd"
    Dim DOC_DATE As String
    Dim REF_DOC_NO As String
    Dim MATERIAL As String
    Dim PLANT As String
    Dim STGE_LOC As String
    Dim MOVE_TYPE As String
    Dim ENTRY_QNT As Integer
    Dim SUMENTRY_QNT As Integer
    Dim PO_NUMBER As String
    Dim PO_ITEM As String
    Dim MVT_IND As String
    Dim PDS_NO As String
    Dim RECOVERY As String
    Dim SERIALNO As String
    Dim REMARKS As String
    Dim BATCH As String
    Dim INVNO As String
    Dim BACKNO As String
    Dim DOC_TYPE_PO As String
    Dim BATCH_NUMBER As String
    Dim countBatch As Integer
    Dim timerErr As Integer = 0
    Dim dateErr As String
    Dim timeErr As String
    Dim err_msg As String
    Dim dt As Date = Date.Today

    Private Sub Form1_Load(sender As Object, e As EventArgs) Handles MyBase.Load
        On Error GoTo ErrorHandler
        'Try
        Me.Hide()
        Me.Visible = False
[connection string omitted]
        con.Open()

[connection string omitted]
        con1.Open()

[connection string omitted]
        con2.Open()

[connection string omitted]
        con3.Open()

[connection string omitted]
        con4.Open()

        cmd.Connection = con
        cmdPO.Connection = con1
        cmdQty.Connection = con2
        cmdLine.Connection = con3

        RfcDestinationManager.RegisterDestinationConfiguration(New ECCDestinationConfig)
        _ccc = RfcDestinationManager.GetDestination("PRD")
        Dim repository As RfcRepository = _ccc.Repository

        Dim receipt As IRfcFunction = _ccc.Repository.CreateFunction("ZZBAPI_GOODSMVT_CREATE")
        Dim tab1 As IRfcTable = receipt.GetTable("ZTAB")

        'sqlquery = "SELECT "
        'sqlquery = sqlquery & "* "
        'sqlquery = sqlquery & "FROM "
        'sqlquery = sqlquery & "TT_PURCHASE_RECEIPT_H "
        'sqlquery = sqlquery & "INNER JOIN "
        'sqlquery = sqlquery & "TT_PURCHASE_RECEIPT_L "
        'sqlquery = sqlquery & "ON "
        'sqlquery = sqlquery & "TT_PURCHASE_RECEIPT_H.CHR_PDS_NO = TT_PURCHASE_RECEIPT_L.CHR_PDS_NO AND "
        'sqlquery = sqlquery & "TT_PURCHASE_RECEIPT_H.INT_PDS_PROCSEQ = TT_PURCHASE_RECEIPT_L.INT_PDS_PROCSEQ  "
        'sqlquery = sqlquery & "WHERE TT_PURCHASE_RECEIPT_H.CHR_PDS_NO LIKE 'S%'  "
        'sqlquery = sqlquery & "AND (TT_PURCHASE_RECEIPT_H.CHR_UPLOAD is null OR TT_PURCHASE_RECEIPT_H.CHR_UPLOAD = '' OR TT_PURCHASE_RECEIPT_H.CHR_UPLOAD = '0' )"
        ''sqlquery = sqlquery & "WHERE  (CHR_SUPPLIER_ID = 'A010-02') AND (CHR_REQ_DATE > '20170300')"
        'sqlquery = sqlquery & "ORDER BY TT_PURCHASE_RECEIPT_H.CHR_PDS_NO, TT_PURCHASE_RECEIPT_H.INT_PDS_PROCSEQ ASC "

        sqlquery = "SELECT top(1) TT_PURCHASE_RECEIPT_H.CHR_PONO_R3 , TT_PURCHASE_RECEIPT_H.CHR_REQ_DATE , TT_PURCHASE_RECEIPT_H.CHR_PDS_NO , TT_PURCHASE_RECEIPT_H.INT_PDS_PROCSEQ , TT_PURCHASE_RECEIPT_H.CHR_REMARKS " & _
        "FROM TT_PURCHASE_RECEIPT_H WHERE TT_PURCHASE_RECEIPT_H.CHR_PDS_NO LIKE 'S%' " & _
        "AND (TT_PURCHASE_RECEIPT_H.CHR_UPLOAD is null OR TT_PURCHASE_RECEIPT_H.CHR_UPLOAD = '' OR TT_PURCHASE_RECEIPT_H.CHR_UPLOAD = '0') " & _
        "ORDER BY TT_PURCHASE_RECEIPT_H.CHR_PDS_NO, TT_PURCHASE_RECEIPT_H.INT_PDS_PROCSEQ ASC"

        cmd = New SqlCommand(sqlquery, con)
        reader = cmd.ExecuteReader
        While reader.Read
            If Not reader.IsDBNull(0) Then
                'Header
                PO_NUMBER = reader("CHR_PONO_R3").ToString.Trim
                DOC_DATE = reader("CHR_REQ_DATE").ToString.Trim
                PSTNG_DATE = reader("CHR_REQ_DATE").ToString.Trim
                REF_DOC_NO = reader("CHR_PDS_NO").ToString.Trim
                PDS_NO = reader("CHR_PDS_NO").ToString.Trim
                RECOVERY = reader("INT_PDS_PROCSEQ").ToString.Trim
                REMARKS = reader("CHR_REMARKS").ToString.Trim
                REMARKS = PDS_NO & "-" & RECOVERY

                sqlquery = "select CHR_DOCUMENT_TYPE from TT_PO_HEADER where CHR_PO_NO = '" & PO_NUMBER & "' "
                cmdPO = New SqlCommand(sqlquery, con4)
                readerPO = cmdPO.ExecuteReader
                While readerPO.Read
                    If Not readerPO.IsDBNull(0) Then
                        DOC_TYPE_PO = readerPO("CHR_DOCUMENT_TYPE").ToString.ToUpper
                    Else
                        DOC_TYPE_PO = "null"
                    End If
                End While
                readerPO.Close()

                'Line
                sqlquery = "SELECT " & _
                "TT_PURCHASE_RECEIPT_L.CHR_PART_NO, TT_PURCHASE_RECEIPT_L.INT_RECQTY, TT_PURCHASE_RECEIPT_L.INT_SUM_RECQTY, " & _
                "TT_PURCHASE_RECEIPT_L.CHR_PONO_LINE_R3, TT_PURCHASE_RECEIPT_L.CHR_SER_NO, TT_PURCHASE_RECEIPT_L.CHR_BATCH_NO, " & _
                "TT_PURCHASE_RECEIPT_L.CHR_INV_NO, TT_PURCHASE_RECEIPT_L.CHR_BACK_NO " & _
                "FROM TT_PURCHASE_RECEIPT_L " & _
                "WHERE TT_PURCHASE_RECEIPT_L.CHR_PDS_NO = '" & PDS_NO & "' AND TT_PURCHASE_RECEIPT_L.INT_PDS_DELNO = '" & RECOVERY & "' AND TT_PURCHASE_RECEIPT_L.INT_PDS_PROCSEQ = '" & RECOVERY & "' "

                cmdLine = New SqlCommand(sqlquery, con3)
                readerLine = cmdLine.ExecuteReader
                While readerLine.Read
                    MATERIAL = readerLine("CHR_PART_NO")
                    ENTRY_QNT = readerLine("INT_RECQTY")
                    SUMENTRY_QNT = readerLine("INT_SUM_RECQTY")
                    PO_ITEM = readerLine("CHR_PONO_LINE_R3")
                    SERIALNO = readerLine("CHR_SER_NO")
                    BATCH = readerLine("CHR_BATCH_NO")
                    INVNO = readerLine("CHR_INV_NO")
                    BACKNO = readerLine("CHR_BACK_NO")

                    If DOC_TYPE_PO = "ZPOS" Then
                        count = "SELECT COUNT(*) FROM ( " & _
                            "SELECT   distinct CHR_PART_NO,(left(CHR_BATCH_NO ,6) ) as BATCH " & _
                            "FROM TT_ORDER_COIL_UPLOAD " & _
                            "WHERE     (CHR_PDS_NO = '" & PDS_NO & "') AND (INT_NUM_RECOVERY = '" & RECOVERY & "')) AS A "
                        cnt = New SqlCommand(count, con4)
                        numrows = cnt.ExecuteScalar()

                        sqlquery = "SELECT distinct LEFT(CHR_BATCH_NO , 6) as 'CHR_BATCH_NO' " & _
                                    "FROM TT_ORDER_COIL_UPLOAD " & _
                                    "WHERE (CHR_PDS_NO = '" & PDS_NO & "') AND (INT_NUM_RECOVERY = '" & RECOVERY & "') AND (CHR_PART_NO = '" & MATERIAL & "')"
                        cmdPO = New SqlCommand(sqlquery, con2)
                        readerPO = cmdPO.ExecuteReader
                        If readerPO.HasRows Then
                            While readerPO.Read
                                BATCH = readerPO("CHR_BATCH_NO").ToString.Trim
                                sqlquery = "SELECT SUM(INT_WEIGHT) as 'qty'  " & _
                                   "FROM TT_ORDER_COIL_UPLOAD " & _
                                   "WHERE (CHR_PDS_NO = '" & PDS_NO & "') AND (INT_NUM_RECOVERY = '" & RECOVERY & "') AND (CHR_PART_NO = '" & MATERIAL & "') AND LEFT(CHR_BATCH_NO , 6) = '" & BATCH & "'"

                                cmdQty = New SqlCommand(sqlquery, con1)
                                readerQty = cmdQty.ExecuteReader
                                If readerQty.HasRows Then
                                    While readerQty.Read
                                        ENTRY_QNT = readerQty("qty")
                                        SUMENTRY_QNT = readerQty("qty")

                                        tab1.Insert()
                                        tab1.SetValue("ZMATERIAL", MATERIAL)
                                        tab1.SetValue("ZPLANT", "600")
                                        tab1.SetValue("ZSTGE_LOC", "WH00")
                                        tab1.SetValue("ZMOVE_TYPE", "101")
                                        tab1.SetValue("ZMVT_IND", "B")
                                        tab1.SetValue("ZENTRY_QNT", ENTRY_QNT)
                                        tab1.SetValue("ZSUMENTRY_QNT", SUMENTRY_QNT)
                                        tab1.SetValue("ZPO_NUMBER", PO_NUMBER)
                                        tab1.SetValue("ZPO_ITEM", PO_ITEM)
                                        tab1.SetValue("ZSERIALNO", SERIALNO)
                                        tab1.SetValue("ZREMARKS", REMARKS)
                                        tab1.SetValue("ZBATCH", BATCH)
                                        tab1.SetValue("ZINVNO", INVNO)
                                        tab1.SetValue("ZBACKNO", BACKNO)
                                        tab1.SetValue("ZCODE", "01")

                                        tab1.SetValue("ZPSTNG_DATE", PSTNG_DATE)
                                        tab1.SetValue("ZDOC_DATE", DOC_DATE)
                                        tab1.SetValue("ZREF_DOC_NO", REF_DOC_NO)

                                        tab1.SetValue("ZPDS", PDS_NO)
                                        tab1.SetValue("ZRECOVERY", RECOVERY)
                                        tab1.SetValue("ZNUMROWS", numrows)
                                        receipt.Invoke(_ccc)
                                    End While
                                End If
                                readerQty.Close()
                            End While
                            readerPO.Close()
                        End If
                    Else
                        count = "SELECT COUNT(*) " & _
                           "FROM  TT_PURCHASE_RECEIPT_L " & _
                           "WHERE     (CHR_PDS_NO = '" & PDS_NO & "') AND (INT_PDS_DELNO = '" & RECOVERY & "')"
                        cnt = New SqlCommand(count, con4)
                        numrows = cnt.ExecuteScalar()

                        tab1.Insert()
                        tab1.SetValue("ZMATERIAL", MATERIAL)
                        tab1.SetValue("ZPLANT", "600")
                        tab1.SetValue("ZSTGE_LOC", "WH00")
                        tab1.SetValue("ZMOVE_TYPE", "101")
                        tab1.SetValue("ZMVT_IND", "B")
                        tab1.SetValue("ZENTRY_QNT", ENTRY_QNT)
                        tab1.SetValue("ZSUMENTRY_QNT", SUMENTRY_QNT)
                        tab1.SetValue("ZPO_NUMBER", PO_NUMBER)
                        tab1.SetValue("ZPO_ITEM", PO_ITEM)
                        tab1.SetValue("ZSERIALNO", SERIALNO)
                        tab1.SetValue("ZREMARKS", REMARKS)
                        tab1.SetValue("ZBATCH", BATCH)
                        tab1.SetValue("ZINVNO", INVNO)
                        tab1.SetValue("ZBACKNO", BACKNO)
                        tab1.SetValue("ZCODE", "01")

                        tab1.SetValue("ZPSTNG_DATE", PSTNG_DATE)
                        tab1.SetValue("ZDOC_DATE", DOC_DATE)
                        tab1.SetValue("ZREF_DOC_NO", REF_DOC_NO)

                        tab1.SetValue("ZPDS", PDS_NO)
                        tab1.SetValue("ZRECOVERY", RECOVERY)
                        tab1.SetValue("ZNUMROWS", numrows)
                        receipt.Invoke(_ccc)
                    End If
                End While
                readerLine.Close()
            End If
        End While
        Me.Close()
        Threading.Thread.Sleep(500)
        'Catch ex As Exception
        'End Try
        Exit Sub

ErrorHandler:  ' Error-handling routine. 
        Timer1.Enabled = True
        dateErr = Format(Now, "yyyyMMdd")
        timeErr = Format(Now, "HHmmss")

        err_msg = (Err.Description.ToString().Replace("'", " ")).Substring(0, 300)

        sqlquery = "INSERT INTO TT_ERR_LOG_INTERFACE (CHR_FUNCTION , CHR_ERROR_MESSAGE , CHR_DATE , CHR_TIME) VALUES " & _
                   "('ERR_RDS_SLT' , '" & err_msg & "' , '" & dateErr & "' , '" & timeErr & "')"
        cmd = New SqlCommand(sqlquery, con)
        cmd.ExecuteNonQuery()
        Me.Close()
        Exit Sub
    End Sub

    Private Sub Timer1_Tick(sender As Object, e As EventArgs) Handles Timer1.Tick
        timerErr = timerErr + 1
        If (timerErr > 10) Then
            Me.Close()
        End If
    End Sub
End Class